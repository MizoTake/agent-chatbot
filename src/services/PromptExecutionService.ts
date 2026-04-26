import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { BotAttachment, BotMessage, BotResponse } from '../interfaces/BotInterface';
import { ToolAttachment, ToolResponse } from '../toolCLIClient';
import { createLogger } from '../utils/logger';
import { ChannelContextService } from './ChannelContextService';
import { ConversationSessionService } from './ConversationSessionService';
import { ToolRuntimeService } from './ToolRuntimeService';

const logger = createLogger('PromptExecutionService');
const IMAGE_MARKDOWN_PATTERN = /!\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\((<[^>]+>|[^)]+)\)/g;
const MARKDOWN_CODE_BLOCK_PATTERN = /(```[\s\S]*?```)/g;
const TEXT_FILE_PREVIEW_MAX_CHARS = 12000;
const TEXT_FILE_BINARY_SNIFF_BYTES = 4096;
const TEXT_FILE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.bat': 'bat',
  '.c': 'c',
  '.cc': 'cpp',
  '.cmd': 'bat',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.csv': 'csv',
  '.cts': 'typescript',
  '.cxx': 'cpp',
  '.env': 'bash',
  '.go': 'go',
  '.gql': 'graphql',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.less': 'less',
  '.log': 'log',
  '.lua': 'lua',
  '.markdown': 'markdown',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.mts': 'typescript',
  '.php': 'php',
  '.ps1': 'powershell',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sass': 'sass',
  '.scss': 'scss',
  '.sh': 'bash',
  '.sql': 'sql',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': '',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml'
};
const TEXT_FILE_LANGUAGE_BY_BASENAME: Record<string, string> = {
  'dockerfile': 'dockerfile',
  'makefile': 'makefile'
};

export interface ParsedPrompt {
  prompt: string;
  toolOverride?: string;
  error?: string;
}

export interface PromptExecutionContext {
  channelId: string;
  toolName: string;
  workingDirectory?: string;
}

interface LocalTargetLocation {
  target: string;
  line?: number;
  column?: number;
}

export class PromptExecutionService {
  private readonly channelExecutionQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly toolRuntimeService: ToolRuntimeService,
    private readonly conversationSessionService: ConversationSessionService,
    private readonly channelContextService: ChannelContextService
  ) {}

  parsePrompt(text: string): ParsedPrompt {
    const trimmed = text.trim();
    if (!trimmed) {
      return { prompt: '', error: 'プロンプトを入力してください。' };
    }

    const match = trimmed.match(/^--tool(?:=|\s+)([a-zA-Z0-9._-]+)\s*([\s\S]*)$/);
    if (!match) {
      return { prompt: trimmed };
    }

    const toolOverride = match[1];
    const prompt = match[2]?.trim();
    if (!prompt) {
      return {
        prompt: '',
        error: '`--tool` 指定時はプロンプトも入力してください。例: `/agent --tool codex 修正案を出して`'
      };
    }

    return { prompt, toolOverride };
  }

  async executePromptRequest(
    message: BotMessage,
    showToolPrefix: boolean,
    notify: (response: BotResponse) => Promise<void>
  ): Promise<BotResponse | null> {
    const toolClient = this.toolRuntimeService.getToolClient();
    const parsed = this.parsePrompt(message.text);
    if (parsed.error) {
      return { text: `❌ ${parsed.error}` };
    }

    if (parsed.toolOverride && !toolClient.hasTool(parsed.toolOverride)) {
      return this.channelContextService.buildUnknownToolResponse(parsed.toolOverride, toolClient);
    }

    return this.withChannelLock(message.channelId, async () => {
      const resolvedRepository = await this.channelContextService.resolveChannelRepository(message.channelId);
      if (!resolvedRepository.repository) {
        return {
          text: '❌ このチャンネルにはリポジトリが紐づいていません。`/agent-repo add` でリポジトリを紐づけてから実行してください。'
        };
      }

      if (resolvedRepository.error) {
        return {
          text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
        };
      }

      const toolName = this.channelContextService.getEffectiveToolName(message.channelId, toolClient, parsed.toolOverride);
      if (resolvedRepository.restored) {
        const clearedConversationCount = this.conversationSessionService.clearConversationState(message.channelId);
        logger.info('Cleared conversation state after repository restore', {
          channelId: message.channelId,
          clearedConversationCount
        });
      }

      const runtimeError = await this.toolRuntimeService.ensureToolReady(toolName);
      if (runtimeError) {
        return { text: runtimeError };
      }

      const context: PromptExecutionContext = {
        channelId: message.channelId,
        toolName,
        workingDirectory: resolvedRepository.repository.localPath
      };

      let result = await toolClient.sendPrompt(parsed.prompt, {
        workingDirectory: context.workingDirectory,
        onBackgroundComplete: async (backgroundResult: ToolResponse) => {
          const backgroundResponse = this.buildBackgroundResponse(context, backgroundResult);
          if (backgroundResponse) {
            await notify(backgroundResponse);
          }
        },
        skipPermissions: this.toolRuntimeService.isSkipPermissionsEnabled(),
        toolName,
        resumeConversation: this.conversationSessionService.shouldResumeConversation(message.channelId),
        sessionId: this.conversationSessionService.getSessionId(message.channelId, toolName)
      });

      if (!result.error || result.timedOut) {
        this.conversationSessionService.markConversationActive(message.channelId);
        if (result.sessionId) {
          this.conversationSessionService.storeSessionId(message.channelId, toolName, result.sessionId);
        }
      }

      result = await this.recoverDisplayableResponse(result, context);
      if (result.timedOut && !this.hasRenderableOutput(result) && !result.error) {
        return null;
      }

      if (result.error) {
        return {
          text: `❌ [${toolName}] ${result.error}`
        };
      }

      if (!this.hasRenderableOutput(result)) {
        result = await this.attemptFreshTextOnlyRetry(parsed.prompt, context);
      }

      if (!this.hasRenderableOutput(result)) {
        logger.warn('Empty response from tool', {
          toolName,
          sessionId: result.sessionId,
          hasError: !!result.error,
          timedOut: result.timedOut
        });
        return {
          text: `⚠️ [${toolName}] ツールは正常に実行されましたが、表示可能な応答がありませんでした。ツールがコード編集などの操作のみを行った可能性があります。再度お試しください。`
        };
      }

      return this.buildBotResponse(toolName, result, showToolPrefix, context.workingDirectory);
    });
  }

  private async withChannelLock<T>(channelId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.channelExecutionQueues.get(channelId) || Promise.resolve();
    const safePrevious = previous.catch(() => {});
    const next = safePrevious.then(() => task());
    const finalize = next.finally(() => {
      if (this.channelExecutionQueues.get(channelId) === finalize) {
        this.channelExecutionQueues.delete(channelId);
      }
    });
    this.channelExecutionQueues.set(channelId, finalize);
    return next;
  }

  async recoverDisplayableResponse(result: ToolResponse, context: PromptExecutionContext): Promise<ToolResponse> {
    const toolClient = this.toolRuntimeService.getToolClient();
    const maxToolOnlyFollowUps = 3;
    const maxEmptyResponseFollowUps = 2;
    const maxContinuationFollowUps = 3;
    let toolOnlyFollowUpCount = 0;
    let emptyResponseFollowUpCount = 0;
    let continuationFollowUpCount = 0;

    logger.debug('recoverDisplayableResponse entry', {
      hasError: !!result.error,
      hasSessionId: !!result.sessionId,
      sessionId: result.sessionId,
      responseLength: result.response?.length || 0,
      toolCallsOnly: result.toolCallsOnly,
      responseTail: result.response?.slice(-50)
    });

    while (!result.error && result.sessionId) {
      if (result.toolCallsOnly && !result.attachments?.length && toolOnlyFollowUpCount < maxToolOnlyFollowUps) {
        toolOnlyFollowUpCount++;
        logger.info('Tool produced only tool calls, sending follow-up prompt', {
          toolName: context.toolName,
          sessionId: result.sessionId,
          attempt: toolOnlyFollowUpCount
        });

        result = await toolClient.sendPrompt(
          '上記の実行結果を踏まえて、ユーザーへの応答本文を日本語で出力してください。',
          {
            workingDirectory: context.workingDirectory,
            skipPermissions: this.toolRuntimeService.isSkipPermissionsEnabled(),
            toolName: context.toolName,
            resumeConversation: true,
            sessionId: result.sessionId
          }
        );

        if (!result.error && result.sessionId) {
          this.conversationSessionService.storeSessionId(context.channelId, context.toolName, result.sessionId);
        }
        continue;
      }

      if (!this.hasRenderableOutput(result) && emptyResponseFollowUpCount < maxEmptyResponseFollowUps) {
        emptyResponseFollowUpCount++;
        logger.warn('Tool returned empty displayable response, sending recovery prompt', {
          toolName: context.toolName,
          sessionId: result.sessionId,
          attempt: emptyResponseFollowUpCount
        });

        result = await toolClient.sendPrompt(
          '直前の応答が空でした。ツール内部表現ではなく、ユーザーに見せる本文だけを日本語で出力してください。',
          {
            workingDirectory: context.workingDirectory,
            skipPermissions: this.toolRuntimeService.isSkipPermissionsEnabled(),
            toolName: context.toolName,
            resumeConversation: true,
            sessionId: result.sessionId
          }
        );

        if (!result.error && result.sessionId) {
          this.conversationSessionService.storeSessionId(context.channelId, context.toolName, result.sessionId);
        }
        continue;
      }

      if (result.response?.trim() && this.looksIncomplete(result.response) && continuationFollowUpCount < maxContinuationFollowUps) {
        continuationFollowUpCount++;
        logger.info('Response appears truncated, requesting continuation', {
          toolName: context.toolName,
          sessionId: result.sessionId,
          attempt: continuationFollowUpCount,
          responseTail: result.response.slice(-50)
        });

        const previousText = result.response;
        const continuation = await toolClient.sendPrompt(
          'continue',
          {
            workingDirectory: context.workingDirectory,
            skipPermissions: this.toolRuntimeService.isSkipPermissionsEnabled(),
            toolName: context.toolName,
            resumeConversation: true,
            sessionId: result.sessionId
          }
        );

        if (!continuation.error && continuation.sessionId) {
          this.conversationSessionService.storeSessionId(context.channelId, context.toolName, continuation.sessionId);
        }

        if (this.hasRenderableOutput(continuation)) {
          result = {
            ...continuation,
            response: previousText + (continuation.response || '')
          };
          continue;
        }
        break;
      }

      break;
    }

    return result;
  }

  async attemptFreshTextOnlyRetry(originalPrompt: string, context: PromptExecutionContext): Promise<ToolResponse> {
    logger.warn('Retrying in a fresh session to recover a displayable response', {
      toolName: context.toolName
    });

    const result = await this.toolRuntimeService.getToolClient().sendPrompt(
      '前回の実行では表示用の本文が取得できませんでした。追加のツール実行やファイル編集は行わず、まずユーザーに見せる回答本文だけを日本語で出力してください。\n\n' +
      `元の依頼:\n${originalPrompt}`,
      {
        workingDirectory: context.workingDirectory,
        skipPermissions: this.toolRuntimeService.isSkipPermissionsEnabled(),
        toolName: context.toolName,
        resumeConversation: false
      }
    );

    if (!result.error && result.sessionId) {
      this.conversationSessionService.storeSessionId(context.channelId, context.toolName, result.sessionId);
    }
    return result;
  }

  private looksIncomplete(text: string): boolean {
    if (!text || text.length < 10) {
      return false;
    }

    const trimmed = text.trimEnd();
    const lastLine = trimmed.split('\n').pop()?.trim() || '';
    if (/[。．！!？?]$/.test(trimmed)) {
      return false;
    }
    if (/\.\s*$/.test(trimmed)) {
      return false;
    }
    if (/```\s*$/.test(trimmed)) {
      return false;
    }
    if (/(?:ます|です|ました|でした|ません)\s*$/.test(trimmed)) {
      return false;
    }
    if (/(?:こと|もの|はず|つもり|ところ|次第)\s*$/.test(trimmed)) {
      return false;
    }
    if (/[)）\]】」』]\s*$/.test(trimmed)) {
      return false;
    }
    if (/\n\s*$/.test(text)) {
      return false;
    }
    if (/^[-*\d]+[.)]\s+.+[。．.！!？?]$/.test(lastLine)) {
      return false;
    }

    logger.debug('Response looks incomplete', {
      lastChars: trimmed.slice(-30),
      length: trimmed.length
    });
    return true;
  }

  private hasRenderableOutput(result: ToolResponse): boolean {
    return Boolean(result.response?.trim() || result.attachments?.length);
  }

  private normalizeMarkdownTarget(target: string): string {
    const trimmed = target.trim();
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }

  private isRemoteUrl(target: string): boolean {
    return /^https?:\/\//i.test(target);
  }

  private isImageTarget(target: string): boolean {
    const normalized = this.normalizeMarkdownTarget(this.stripLocalTargetLocation(target).target).split('?')[0].split('#')[0].toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'].some(ext => normalized.endsWith(ext));
  }

  private stripWindowsDriveRootPrefix(target: string): string {
    return /^[\\/][A-Za-z]:[\\/]/.test(target) ? target.slice(1) : target;
  }

  private normalizeResolvedLocalPath(resolvedPath: string): string {
    const stripped = this.stripWindowsDriveRootPrefix(resolvedPath);
    const normalized = path.normalize(stripped);
    return normalized.replace(/^([A-Za-z]:[\\/])(?=[A-Za-z]:[\\/])/i, '');
  }

  private stripLocalTargetLocation(target: string, workingDirectory?: string): LocalTargetLocation {
    const normalizedTarget = this.normalizeMarkdownTarget(target);
    if (!normalizedTarget || this.isRemoteUrl(normalizedTarget)) {
      return { target: normalizedTarget };
    }

    const match = normalizedTarget.match(/^(.*?)(?::(\d+)(?::(\d+))?)$/);
    if (!match) {
      return { target: normalizedTarget };
    }

    const candidate = match[1];
    if (!candidate) {
      return { target: normalizedTarget };
    }

    const normalizedCandidate = this.stripWindowsDriveRootPrefix(candidate);
    const candidateLower = normalizedCandidate.toLowerCase();
    const candidateBasename = path.basename(normalizedCandidate).toLowerCase();
    const candidateExtension = path.extname(candidateLower);
    const knownTextFile = candidateExtension in TEXT_FILE_LANGUAGE_BY_EXTENSION || candidateBasename in TEXT_FILE_LANGUAGE_BY_BASENAME;
    const knownImageFile = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'].includes(candidateExtension);
    if (!knownTextFile && !knownImageFile && !/^file:\/\//i.test(candidate) && !/^[A-Za-z]:[\\/]/.test(normalizedCandidate) && !/^[\\/]/.test(candidate)) {
      const absoluteCandidate = this.normalizeResolvedLocalPath(path.resolve(workingDirectory || process.cwd(), candidate));
      if (!fs.existsSync(absoluteCandidate)) {
        return { target: normalizedTarget };
      }
    }

    return {
      target: candidate,
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined
    };
  }

  private formatLocationSuffix(location: LocalTargetLocation): string {
    if (!location.line) {
      return '';
    }

    return location.column ? ` (L${location.line}:C${location.column})` : ` (L${location.line})`;
  }

  private resolveAttachmentPath(target: string, workingDirectory?: string): string | undefined {
    const normalizedTarget = this.stripWindowsDriveRootPrefix(this.stripLocalTargetLocation(target, workingDirectory).target);
    if (!normalizedTarget || this.isRemoteUrl(normalizedTarget)) {
      return undefined;
    }

    if (/^file:\/\//i.test(normalizedTarget)) {
      try {
        return this.normalizeResolvedLocalPath(fileURLToPath(normalizedTarget));
      } catch {
        return undefined;
      }
    }

    if (path.isAbsolute(normalizedTarget)) {
      return this.normalizeResolvedLocalPath(normalizedTarget);
    }

    if (workingDirectory) {
      return this.normalizeResolvedLocalPath(path.resolve(workingDirectory, normalizedTarget));
    }

    return this.normalizeResolvedLocalPath(path.resolve(normalizedTarget));
  }

  private escapeMaskedLinkLabel(label: string): string {
    return label.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\r?\n/g, ' ');
  }

  private buildMaskedLink(label: string, target: string, workingDirectory?: string): string | undefined {
    const normalizedTarget = this.normalizeMarkdownTarget(this.stripLocalTargetLocation(target, workingDirectory).target);
    const safeLabel = this.escapeMaskedLinkLabel(label.trim() || path.basename(normalizedTarget) || 'link');
    if (this.isRemoteUrl(normalizedTarget)) {
      return `[${safeLabel}](${normalizedTarget})`;
    }

    const resolvedPath = this.resolveAttachmentPath(normalizedTarget, workingDirectory);
    if (!resolvedPath) {
      return undefined;
    }

    return `[${safeLabel}](${pathToFileURL(resolvedPath).href})`;
  }

  private inferTextFileLanguage(filePath: string): string | undefined {
    const basename = path.basename(filePath).toLowerCase();
    const basenameLanguage = TEXT_FILE_LANGUAGE_BY_BASENAME[basename];
    if (basenameLanguage !== undefined) {
      return basenameLanguage || undefined;
    }

    const extension = path.extname(basename);
    const extensionLanguage = TEXT_FILE_LANGUAGE_BY_EXTENSION[extension];
    return extensionLanguage === undefined ? undefined : extensionLanguage || undefined;
  }

  private isLikelyTextFile(filePath: string, buffer: Buffer): boolean {
    const language = this.inferTextFileLanguage(filePath);
    if (language !== undefined || path.extname(filePath).toLowerCase() === '.txt') {
      return true;
    }

    return !buffer.subarray(0, Math.min(buffer.length, TEXT_FILE_BINARY_SNIFF_BYTES)).includes(0);
  }

  private buildTextFilePreview(resolvedPath: string, displayLabel: string): string | undefined {
    if (!fs.existsSync(resolvedPath)) {
      return undefined;
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return undefined;
    }

    const buffer = fs.readFileSync(resolvedPath);
    if (!this.isLikelyTextFile(resolvedPath, buffer)) {
      return undefined;
    }

    const language = this.inferTextFileLanguage(resolvedPath);
    const rawContent = buffer.toString('utf8');
    const truncated = rawContent.length > TEXT_FILE_PREVIEW_MAX_CHARS;
    const content = truncated ? rawContent.slice(0, TEXT_FILE_PREVIEW_MAX_CHARS) : rawContent;
    const normalizedContent = content.endsWith('\n') ? content : `${content}\n`;
    const fence = language ? `\`\`\`${language}` : '```';
    return `### ${displayLabel}\n${fence}\n${normalizedContent}\`\`\`${truncated ? `\n-# ファイルが長いため先頭 ${TEXT_FILE_PREVIEW_MAX_CHARS} 文字のみ表示しています。` : ''}`;
  }

  private addAttachment(attachments: BotAttachment[], attachment: BotAttachment | undefined): void {
    if (!attachment) {
      return;
    }

    if (attachments.some(existing => (
      (existing.path && attachment.path && existing.path === attachment.path) ||
      (existing.url && attachment.url && existing.url === attachment.url)
    ))) {
      return;
    }

    attachments.push(attachment);
  }

  private normalizeToolAttachments(toolAttachments: ToolAttachment[] | undefined, workingDirectory?: string): BotAttachment[] {
    const attachments: BotAttachment[] = [];

    for (const attachment of toolAttachments || []) {
      if (attachment.path) {
        const resolvedPath = this.resolveAttachmentPath(attachment.path, workingDirectory);
        this.addAttachment(attachments, resolvedPath ? {
          kind: 'image',
          path: resolvedPath,
          altText: attachment.altText
        } : undefined);
        continue;
      }

      if (attachment.url) {
        this.addAttachment(attachments, {
          kind: 'image',
          url: this.normalizeMarkdownTarget(attachment.url),
          altText: attachment.altText
        });
      }
    }

    return attachments;
  }

  private createLocalImageAttachment(target: string, workingDirectory?: string, altText?: string): BotAttachment | undefined {
    const normalizedTarget = this.normalizeMarkdownTarget(target);
    if (!this.isImageTarget(normalizedTarget) || this.isRemoteUrl(normalizedTarget)) {
      return undefined;
    }

    const resolvedPath = this.resolveAttachmentPath(normalizedTarget, workingDirectory);
    if (!resolvedPath) {
      return undefined;
    }

    return {
      kind: 'image',
      path: resolvedPath,
      altText: altText?.trim() || undefined
    };
  }

  private extractMarkdownArtifacts(text: string, workingDirectory?: string): { text: string; attachments: BotAttachment[] } {
    const attachments: BotAttachment[] = [];
    const textFilePreviews: string[] = [];
    const previewedTextFiles = new Set<string>();
    const processMarkdownSegment = (segment: string): string => {
      const textWithoutImageMarkdown = segment.replace(IMAGE_MARKDOWN_PATTERN, (_match, altText: string, rawTarget: string) => {
        const target = this.normalizeMarkdownTarget(rawTarget);
        if (!this.isImageTarget(target)) {
          return _match;
        }

        if (this.isRemoteUrl(target)) {
          return target;
        }

        const displayLabel = altText?.trim() || path.basename(target) || 'image';
        const attachment = this.createLocalImageAttachment(target, workingDirectory, altText);
        if (!attachment) {
          return _match;
        }

        this.addAttachment(attachments, attachment);
        const locationSuffix = this.formatLocationSuffix(this.stripLocalTargetLocation(target, workingDirectory));
        return (this.buildMaskedLink(displayLabel, target, workingDirectory) || displayLabel) + locationSuffix;
      });

      return textWithoutImageMarkdown.replace(MARKDOWN_LINK_PATTERN, (_match, label: string, rawTarget: string) => {
        const target = this.normalizeMarkdownTarget(rawTarget);
        const displayLabel = label?.trim() || path.basename(target);
        const location = this.stripLocalTargetLocation(target, workingDirectory);
        const locationSuffix = this.formatLocationSuffix(location);
        if (this.isImageTarget(target)) {
          const attachment = this.createLocalImageAttachment(target, workingDirectory, displayLabel);
          if (attachment) {
            this.addAttachment(attachments, attachment);
          }
          return (this.buildMaskedLink(displayLabel, target, workingDirectory) || displayLabel) + locationSuffix;
        }

        if (this.isRemoteUrl(target)) {
          return this.buildMaskedLink(displayLabel, target, workingDirectory) || _match;
        }

        const resolvedPath = this.resolveAttachmentPath(target, workingDirectory);
        if (!resolvedPath) {
          return _match;
        }

        const maskedLink = (this.buildMaskedLink(displayLabel, target, workingDirectory) || _match) + locationSuffix;
        if (!previewedTextFiles.has(resolvedPath)) {
          const preview = this.buildTextFilePreview(resolvedPath, `${displayLabel}${locationSuffix}`);
          if (preview) {
            textFilePreviews.push(preview);
            previewedTextFiles.add(resolvedPath);
          }
        }

        return maskedLink;
      });
    };
    const sanitizedText = text.split(MARKDOWN_CODE_BLOCK_PATTERN).map((segment, index) => index % 2 === 1 ? segment : processMarkdownSegment(segment)).join('');
    const mergedText = [sanitizedText.trim(), ...textFilePreviews].filter(part => part.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

    return {
      text: mergedText,
      attachments
    };
  }

  private buildBotResponse(
    toolName: string,
    result: ToolResponse,
    showToolPrefix: boolean,
    workingDirectory?: string
  ): BotResponse {
    const normalizedAttachments = this.normalizeToolAttachments(result.attachments, workingDirectory);
    const extracted = this.extractMarkdownArtifacts(result.response || '', workingDirectory);

    for (const attachment of extracted.attachments) {
      this.addAttachment(normalizedAttachments, attachment);
    }

    const response: BotResponse = {
      text: extracted.text
    };

    if (extracted.text) {
      response.blocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: showToolPrefix ? `*${toolName} says:*\n${extracted.text}` : extracted.text
          }
        }
      ];
    }

    if (normalizedAttachments.length > 0) {
      response.attachments = normalizedAttachments;
    }

    return response;
  }

  private buildBackgroundResponse(context: PromptExecutionContext, result: ToolResponse): BotResponse | null {
    if (this.hasRenderableOutput(result)) {
      return this.buildBotResponse(context.toolName, result, false, context.workingDirectory);
    }

    if (result.error) {
      return {
        text: `❌ [${context.toolName}] ${result.error}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ [${context.toolName}] ${result.error}`
            }
          }
        ]
      };
    }

    return null;
  }
}
