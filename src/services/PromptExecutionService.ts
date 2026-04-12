import { BotMessage, BotResponse } from '../interfaces/BotInterface';
import { ToolResponse } from '../toolCLIClient';
import { createLogger } from '../utils/logger';
import { ChannelContextService } from './ChannelContextService';
import { ConversationSessionService } from './ConversationSessionService';
import { ToolRuntimeService } from './ToolRuntimeService';

const logger = createLogger('PromptExecutionService');

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

export class PromptExecutionService {
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

    const resolvedRepository = await this.channelContextService.resolveChannelRepository(message.channelId);
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
      workingDirectory: resolvedRepository.repository?.localPath
    };

    let result = await toolClient.sendPrompt(parsed.prompt, {
      workingDirectory: context.workingDirectory,
      onBackgroundComplete: async (backgroundResult: ToolResponse) => {
        const backgroundResponse = this.buildBackgroundResponse(context.toolName, backgroundResult);
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
    if (result.error) {
      return {
        text: `❌ [${toolName}] ${result.error}`
      };
    }

    if (!result.response?.trim()) {
      result = await this.attemptFreshTextOnlyRetry(parsed.prompt, context);
    }

    if (!result.response?.trim()) {
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

    const body = showToolPrefix ? `*${toolName} says:*\n${result.response}` : result.response;
    return {
      text: result.response,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: body
          }
        }
      ]
    };
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
      if (result.toolCallsOnly && toolOnlyFollowUpCount < maxToolOnlyFollowUps) {
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

      if (!result.response?.trim() && emptyResponseFollowUpCount < maxEmptyResponseFollowUps) {
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

        if (continuation.response?.trim()) {
          result = {
            ...continuation,
            response: previousText + continuation.response
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

  private buildBackgroundResponse(toolName: string, result: ToolResponse): BotResponse | null {
    if (result.response?.trim()) {
      return {
        text: result.response,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: result.response
            }
          }
        ]
      };
    }

    if (result.error) {
      return {
        text: `❌ [${toolName}] ${result.error}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ [${toolName}] ${result.error}`
            }
          }
        ]
      };
    }

    return null;
  }
}
