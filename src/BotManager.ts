import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { BotAdapter, BotMessage, BotResponse } from './interfaces/BotInterface';
import { SlackAdapter } from './adapters/SlackAdapter';
import { DiscordAdapter } from './adapters/DiscordAdapter';
import { ToolCLIClient, ToolConfig, ToolResponse } from './toolCLIClient';
import { ChannelRepository, StorageService } from './services/StorageService';
import { ToolPreferenceService } from './services/ToolPreferenceService';
import { GitService } from './services/GitService';
import { createLogger } from './utils/logger';
import { ConfigLoader } from './config/configLoader';

const logger = createLogger('BotManager');

/**
 * LMStudio の /v1/models API を叩いて稼働中のモデル一覧を取得する。
 * 取得できなかった場合は空配列を返す。
 */
async function fetchLMStudioModels(baseUrl: string): Promise<string[]> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const body = await res.json() as { data?: { id: string }[] };
    return (body.data || []).map(m => m.id).filter(Boolean);
  } catch {
    return [];
  }
}

interface ParsedPrompt {
  prompt: string;
  toolOverride?: string;
  error?: string;
}

interface ResolvedRepository {
  repository?: ChannelRepository;
  restored?: boolean;
  error?: string;
}

export class BotManager {
  private bots: BotAdapter[] = [];
  private toolClient: ToolCLIClient;
  private storageService: StorageService;
  private toolPreferenceService: ToolPreferenceService;
  private gitService: GitService;
  // Channels where resume has been explicitly disabled by /agent-clear.
  // Resume is ON by default; it is turned OFF only after a clear, and automatically
  // re-enabled once the next message succeeds (starting a fresh session).
  private clearedChannels: Set<string> = new Set();

  // Per-channel session IDs for tools that support explicit session resumption.
  // Key: "<channelId>::<toolName>", value: session ID returned by the tool CLI.
  private sessionMap: Map<string, string> = new Map();
  private skipPermissionsEnabled: boolean = false;
  private readonly configLoadPromise: Promise<void>;

  constructor() {
    this.toolClient = new ToolCLIClient();
    this.storageService = new StorageService();
    this.toolPreferenceService = new ToolPreferenceService();
    this.gitService = new GitService();

    this.configLoadPromise = this.loadConfig();
  }

  private async loadConfig(): Promise<void> {
    try {
      await ConfigLoader.load();
      logger.info('Configuration loaded successfully');

      const claudeCommand = process.env.CLAUDE_COMMAND || ConfigLoader.get('claude.command', 'claude');
      const timeout = ConfigLoader.get('claude.timeout', 3600000);
      const maxOutputSize = ConfigLoader.get('claude.maxOutputSize', 10485760);

      // opencode: LMStudio用モニタースクリプト or 直接実行を環境変数で切り替え
      const opencodeUseMonitor = (process.env.OPENCODE_USE_MONITOR || 'false').toLowerCase() === 'true';
      const opencodeCommand = opencodeUseMonitor ? 'bash' : (process.env.OPENCODE_COMMAND || 'opencode-cli');
      // モニタースクリプトは絶対パスで渡す（spawn の cwd がリポジトリパスになる場合でも解決できるように）
      const monitorScriptPath = path.resolve(process.cwd(), 'scripts', 'opencode-monitor.sh');
      const opencodeArgs = opencodeUseMonitor
        ? [monitorScriptPath, 'run', '--format', 'json', '{prompt}']
        : (process.env.OPENCODE_ARGS?.split(' ') || ['run', '--format', 'json', '{prompt}']);

      // codex: 環境変数で OSS モデル対応（--provider / --model）
      // デフォルトは lmstudio。モデル未指定時は LMStudio API から自動検出する。
      const codexCommand = process.env.CODEX_COMMAND || 'codex';
      const codexProvider = process.env.CODEX_PROVIDER || 'lmstudio';
      let codexModel = process.env.CODEX_MODEL || undefined;

      if (!codexModel && codexProvider === 'lmstudio') {
        const lmstudioUrl = process.env.LMSTUDIO_URL || 'http://localhost:1234';
        const models = await fetchLMStudioModels(lmstudioUrl);
        if (models.length > 0) {
          codexModel = models[0];
          logger.info('Auto-detected LMStudio model for codex', { model: codexModel, available: models });
        } else {
          logger.warn('LMStudio is not running or has no models loaded — codex will use provider default');
        }
      }

      // takt: 環境変数でコマンド名とオプションを切り替え可能
      const taktCommand = process.env.TAKT_COMMAND || 'takt';
      const taktArgs = process.env.TAKT_ARGS?.split(' ')
        || ['--pipeline', '--task', '{prompt}'];

      const configuredTools = ConfigLoader.get<Record<string, ToolConfig>>('tools.definitions', {});
      const mergedTools: Record<string, ToolConfig> = {
        claude: {
          command: claudeCommand,
          args: ['--dangerously-skip-permissions', '--print', '--output-format', 'json', '{prompt}'],
          versionArgs: ['--version'],
          description: 'Anthropic Claude CLI',
          supportsSkipPermissions: true
        },
        codex: {
          command: codexCommand,
          args: ['exec', '--sandbox', 'danger-full-access', '{prompt}'],
          versionArgs: ['--version'],
          description: 'OpenAI Codex CLI',
          provider: codexProvider,
          model: codexModel
        },
        opencode: {
          command: opencodeCommand,
          args: opencodeArgs,
          versionArgs: ['--version'],
          description: 'OpenCode CLI',
          supportsSkipPermissions: false
        },
        takt: {
          command: taktCommand,
          args: taktArgs,
          versionArgs: ['--version'],
          description: 'TAKT Agent Orchestrator',
          supportsSkipPermissions: false
        },
        ...configuredTools
      };

      const defaultTool = ConfigLoader.get('tools.defaultTool', 'claude');
      this.toolClient = new ToolCLIClient(mergedTools, defaultTool, timeout, maxOutputSize);

      this.skipPermissionsEnabled = ConfigLoader.get('claude.dangerouslySkipPermissions', false);
    } catch (error) {
      logger.error('Failed to load config', error);
    }
  }

  addSlackBot(token: string, signingSecret: string, appToken: string): void {
    const slackBot = new SlackAdapter(token, signingSecret, appToken, this.resolveAgentDisplayName());
    this.setupBot(slackBot);
    this.bots.push(slackBot);
  }

  addDiscordBot(token: string): void {
    const discordBot = new DiscordAdapter(token, this.resolveAgentDisplayName());
    this.setupBot(discordBot);
    this.bots.push(discordBot);
  }

  private resolveAgentDisplayName(): string {
    const explicitName = process.env.AGENT_CHATBOT_APP_NAME?.trim();
    if (explicitName) {
      return explicitName;
    }

    const envDefaultTool = process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL?.trim();
    if (envDefaultTool) {
      return envDefaultTool;
    }

    return this.toolClient.getDefaultToolName();
  }

  private buildConversationKey(channelId: string, toolName: string): string {
    return `${channelId}::${toolName}`;
  }

  private shouldResumeConversation(channelId: string, _toolName: string): boolean {
    return !this.clearedChannels.has(channelId);
  }

  private markConversationActive(channelId: string, _toolName: string): void {
    // Re-enable resume after the first successful exchange following a clear
    this.clearedChannels.delete(channelId);
  }

  private clearConversationState(channelId: string): number {
    const alreadyCleared = this.clearedChannels.has(channelId);
    this.clearedChannels.add(channelId);

    // Also wipe per-channel session IDs so the next message starts a fresh session
    const prefix = `${channelId}::`;
    for (const key of this.sessionMap.keys()) {
      if (key.startsWith(prefix)) {
        this.sessionMap.delete(key);
      }
    }

    return alreadyCleared ? 0 : 1;
  }

  private parsePrompt(text: string): ParsedPrompt {
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

  private getEffectiveToolName(channelId: string, requestTool?: string): string {
    if (requestTool) {
      return requestTool;
    }

    const channelTool = this.toolPreferenceService.getChannelTool(channelId)?.toolName;
    if (channelTool) {
      if (this.toolClient.hasTool(channelTool)) {
        return channelTool;
      }
      logger.warn('Channel tool preference is stale (tool not registered), falling back to default', {
        channelId,
        staleTool: channelTool,
        defaultTool: this.toolClient.getDefaultToolName()
      });
    }

    return this.toolClient.getDefaultToolName();
  }

  private getToolNames(): string[] {
    return this.toolClient.listTools().map(tool => tool.name);
  }

  private async recoverDisplayableResponse(
    result: ToolResponse,
    toolName: string,
    workingDirectory: string | undefined,
    sessionKey: string
  ): Promise<ToolResponse> {
    const maxToolOnlyFollowUps = 3;
    const maxEmptyResponseFollowUps = 2;
    let toolOnlyFollowUpCount = 0;
    let emptyResponseFollowUpCount = 0;

    while (!result.error && result.sessionId) {
      if (result.toolCallsOnly && toolOnlyFollowUpCount < maxToolOnlyFollowUps) {
        toolOnlyFollowUpCount++;
        logger.info('Tool produced only tool calls, sending follow-up prompt', {
          toolName,
          sessionId: result.sessionId,
          attempt: toolOnlyFollowUpCount
        });

        result = await this.toolClient.sendPrompt(
          '上記の実行結果を踏まえて、ユーザーへの応答本文を日本語で出力してください。',
          {
            workingDirectory,
            skipPermissions: this.skipPermissionsEnabled,
            toolName,
            resumeConversation: true,
            sessionId: result.sessionId
          }
        );

        if (!result.error && result.sessionId) {
          this.sessionMap.set(sessionKey, result.sessionId);
        }
        continue;
      }

      if (!result.response?.trim() && emptyResponseFollowUpCount < maxEmptyResponseFollowUps) {
        emptyResponseFollowUpCount++;
        logger.warn('Tool returned empty displayable response, sending recovery prompt', {
          toolName,
          sessionId: result.sessionId,
          attempt: emptyResponseFollowUpCount
        });

        result = await this.toolClient.sendPrompt(
          '直前の応答が空でした。ツール内部表現ではなく、ユーザーに見せる本文だけを日本語で出力してください。',
          {
            workingDirectory,
            skipPermissions: this.skipPermissionsEnabled,
            toolName,
            resumeConversation: true,
            sessionId: result.sessionId
          }
        );

        if (!result.error && result.sessionId) {
          this.sessionMap.set(sessionKey, result.sessionId);
        }
        continue;
      }

      break;
    }

    return result;
  }

  private async attemptFreshTextOnlyRetry(
    originalPrompt: string,
    toolName: string,
    workingDirectory: string | undefined,
    sessionKey: string
  ): Promise<ToolResponse> {
    logger.warn('Retrying in a fresh session to recover a displayable response', {
      toolName
    });

    const retryPrompt =
      '前回の実行では表示用の本文が取得できませんでした。' +
      '追加のツール実行やファイル編集は行わず、まずユーザーに見せる回答本文だけを日本語で出力してください。\n\n' +
      `元の依頼:\n${originalPrompt}`;

    const result = await this.toolClient.sendPrompt(retryPrompt, {
      workingDirectory,
      skipPermissions: this.skipPermissionsEnabled,
      toolName,
      resumeConversation: false
    });

    if (!result.error && result.sessionId) {
      this.sessionMap.set(sessionKey, result.sessionId);
    }

    return result;
  }

  private getUnknownToolResponse(toolName: string): BotResponse {
    const available = this.getToolNames();
    return {
      text: `❌ 未対応ツール: ${toolName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ 未対応ツール: \`${toolName}\`\n\n` +
              `利用可能: ${available.map(name => `\`${name}\``).join(', ')}`
          }
        }
      ]
    };
  }

  private async resolveChannelRepository(channelId: string): Promise<ResolvedRepository> {
    const repository = this.storageService.getChannelRepository(channelId);
    if (!repository) {
      return {};
    }

    if (this.gitService.repositoryExists(repository.localPath)) {
      return { repository };
    }

    // Locally-created repositories cannot be re-cloned from a remote URL
    if (repository.repositoryUrl.startsWith('local://')) {
      logger.warn('Locally-created repository is missing and cannot be re-cloned', {
        channelId,
        repositoryUrl: repository.repositoryUrl,
        missingLocalPath: repository.localPath
      });
      return {
        repository,
        error: 'ローカルリポジトリのディレクトリが見つかりません。`/agent-repo delete` で登録を削除してから再作成してください。'
      };
    }

    logger.warn('Repository localPath not found. Re-cloning linked repository', {
      channelId,
      repositoryUrl: repository.repositoryUrl,
      missingLocalPath: repository.localPath
    });

    const cloneResult = await this.gitService.cloneRepository(repository.repositoryUrl, channelId);
    if (!cloneResult.success || !cloneResult.localPath) {
      logger.error(
        'Failed to re-clone repository for missing localPath',
        cloneResult.error,
        {
          channelId,
          repositoryUrl: repository.repositoryUrl,
          missingLocalPath: repository.localPath
        }
      );
      return {
        repository,
        error: cloneResult.error || '不明なエラー'
      };
    }

    this.storageService.setChannelRepository(channelId, repository.repositoryUrl, cloneResult.localPath);
    const restoredRepository = this.storageService.getChannelRepository(channelId);

    logger.info('Repository re-cloned and channel mapping updated', {
      channelId,
      repositoryUrl: repository.repositoryUrl,
      oldLocalPath: repository.localPath,
      newLocalPath: cloneResult.localPath
    });

    return {
      repository: restoredRepository,
      restored: true
    };
  }

  private async handlePromptRequest(
    bot: BotAdapter,
    message: BotMessage,
    showToolPrefix: boolean
  ): Promise<BotResponse | null> {
    const parsed = this.parsePrompt(message.text);
    if (parsed.error) {
      return { text: `❌ ${parsed.error}` };
    }

    if (parsed.toolOverride && !this.toolClient.hasTool(parsed.toolOverride)) {
      return this.getUnknownToolResponse(parsed.toolOverride);
    }

    const resolvedRepository = await this.resolveChannelRepository(message.channelId);
    if (resolvedRepository.error) {
      return {
        text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
      };
    }

    const toolName = this.getEffectiveToolName(message.channelId, parsed.toolOverride);
    const repo = resolvedRepository.repository;
    const workingDirectory = repo?.localPath;
    if (resolvedRepository.restored) {
      const clearedConversationCount = this.clearConversationState(message.channelId);
      logger.info('Cleared conversation state after repository restore', {
        channelId: message.channelId,
        clearedConversationCount
      });
    }
    const resumeConversation = this.shouldResumeConversation(message.channelId, toolName);
    const sessionKey = this.buildConversationKey(message.channelId, toolName);
    const sessionId = this.sessionMap.get(sessionKey);

    const onBackgroundComplete = async (bgResult: any) => {
      await bot.sendMessage(message.channelId, {
        text: '✅ バックグラウンド処理が完了しました',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: bgResult.error
                ? `❌ [${toolName}] バックグラウンド処理でエラーが発生しました:\n${bgResult.error}`
                : `✅ [${toolName}] バックグラウンド処理が完了しました:\n${bgResult.response}`
            }
          }
        ]
      });
    };

    // OSS プロバイダー (lmstudio/ollama) 利用時はプリフライトチェック
    const toolInfo = this.toolClient.getToolInfo(toolName);
    if (toolInfo?.provider === 'lmstudio') {
      const lmstudioUrl = process.env.LMSTUDIO_URL || 'http://localhost:1234';
      const models = await fetchLMStudioModels(lmstudioUrl);
      if (models.length === 0) {
        return {
          text: `❌ [${toolName}] LMStudio が応答しません（${lmstudioUrl}）。LMStudio が起動中でモデルがロードされているか確認してください。`
        };
      }
    }

    let result = await this.toolClient.sendPrompt(parsed.prompt, {
      workingDirectory,
      onBackgroundComplete,
      skipPermissions: this.skipPermissionsEnabled,
      toolName,
      resumeConversation,
      sessionId
    });

    if (!result.error || result.timedOut) {
      this.markConversationActive(message.channelId, toolName);
      if (result.sessionId) {
        this.sessionMap.set(sessionKey, result.sessionId);
      }
    }

    result = await this.recoverDisplayableResponse(result, toolName, workingDirectory, sessionKey);

    if (result.error) {
      return {
        text: `❌ [${toolName}] ${result.error}`
      };
    }

    if (!result.response?.trim()) {
      result = await this.attemptFreshTextOnlyRetry(parsed.prompt, toolName, workingDirectory, sessionKey);
    }

    if (!result.response?.trim()) {
      logger.warn('Empty response from tool', {
        toolName,
        sessionId: result.sessionId,
        hasError: !!result.error,
        timedOut: result.timedOut
      });
      // Provide a more actionable message — the tool ran successfully (no error)
      // but produced no displayable output. This often means the LLM responded
      // with only tool calls / internal tokens and no user-facing text.
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

  private setupBot(bot: BotAdapter): void {
    const registerCommandAliases = (
      commands: string[],
      handler: (message: BotMessage) => Promise<BotResponse | null>
    ): void => {
      commands.forEach(command => bot.onCommand(command, handler));
    };

    bot.onMessage(async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '👋 Hi! How can I help you? Just send me your question.'
        };
      }

      return this.handlePromptRequest(bot, message, false);
    });

    registerCommandAliases(['agent', 'claude'], async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '📝 Please provide a prompt. Usage: `/agent <your prompt>` or `/agent --tool <tool> <your prompt>`'
        };
      }

      return this.handlePromptRequest(bot, message, true);
    });

    registerCommandAliases(['agent-tool', 'claude-tool'], async (message: BotMessage): Promise<BotResponse | null> => {
      const input = message.text?.trim() || 'status';
      const [action, value] = input.split(/\s+/, 2);
      const availableTools = this.toolClient.listTools();
      const currentTool = this.getEffectiveToolName(message.channelId);
      const channelTool = this.toolPreferenceService.getChannelTool(message.channelId)?.toolName;

      if (action === 'list') {
        const statuses = await Promise.all(
          availableTools.map(async (tool) => ({
            tool,
            available: await this.toolClient.checkAvailability(tool.name)
          }))
        );

        const lines = statuses.map(({ tool, available }) =>
          `• \`${tool.name}\` (${available ? '✅ 利用可能' : '❌ 未検出'}) - command: \`${tool.command}\``
        );

        return {
          text: '利用可能なツール一覧',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*利用可能なツール*\n\n${lines.join('\n')}`
              }
            }
          ]
        };
      }

      if (action === 'status') {
        const currentAvailable = await this.toolClient.checkAvailability(currentTool);
        const defaultTool = this.toolClient.getDefaultToolName();
        // stale: saved preference points to a tool not in the registry
        const channelToolStale = channelTool && !this.toolClient.hasTool(channelTool);
        const channelToolLine = channelTool
          ? `\`${channelTool}\`` + (channelToolStale ? ' ⚠️ 未登録ツール（`/agent-tool clear` でリセット推奨）' : '')
          : '未設定（デフォルト使用中）';
        return {
          text: 'ツール設定ステータス',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*現在の有効ツール:* \`${currentTool}\` (${currentAvailable ? '✅ 利用可能' : '❌ 未検出'})\n` +
                  `*チャンネル固定ツール:* ${channelToolLine}\n` +
                  `*デフォルトツール:* \`${defaultTool}\`\n` +
                  `*登録済みツール:* ${availableTools.map(tool => `\`${tool.name}\``).join(', ')}`
              }
            }
          ]
        };
      }

      if (action === 'use') {
        if (!value) {
          return {
            text: '❌ 使用するツール名を指定してください。例: `/agent-tool use opencode`'
          };
        }

        if (!this.toolClient.hasTool(value)) {
          return this.getUnknownToolResponse(value);
        }

        this.toolPreferenceService.setChannelTool(message.channelId, value);
        return {
          text: `✅ このチャンネルの既定ツールを \`${value}\` に設定しました`
        };
      }

      if (action === 'clear') {
        const cleared = this.toolPreferenceService.clearChannelTool(message.channelId);
        const defaultTool = this.toolClient.getDefaultToolName();
        return {
          text: cleared
            ? `✅ チャンネル固定ツール設定を削除しました（デフォルト: \`${defaultTool}\` に戻りました）`
            : `ℹ️ チャンネル固定ツールは設定されていません（デフォルト: \`${defaultTool}\`）`
        };
      }

      if (action === 'reset') {
        const count = this.toolPreferenceService.clearAll();
        const defaultTool = this.toolClient.getDefaultToolName();
        return {
          text: count > 0
            ? `✅ 全チャンネルのツール固定設定を削除しました（${count}件 → デフォルト: \`${defaultTool}\`）`
            : `ℹ️ 固定ツール設定は1件もありませんでした（デフォルト: \`${defaultTool}\`）`
        };
      }

      return {
        text:
          '❌ 無効なサブコマンドです。\n' +
          '使用方法: `/agent-tool status` `/agent-tool list` `/agent-tool use <tool>` `/agent-tool clear` `/agent-tool reset`'
      };
    });

    // /takt-run: takt を --pipeline モードで直接実行するコマンド
    registerCommandAliases(['takt-run'], async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text?.trim()) {
        return {
          text: '📝 使い方',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*TAKT 実行コマンド*\n\n' +
                  '• `/takt-run <タスク>` - パイプラインモードでタスクを実行\n' +
                  '• `/takt-run --auto-pr <タスク>` - 実行後にPRを自動作成\n' +
                  '• `/takt-run --provider claude <タスク>` - プロバイダーを指定\n' +
                  '• `/takt-run --piece dual <タスク>` - ピースを指定\n' +
                  '• `/takt-run --model provider/model <タスク>` - モデルを指定\n\n' +
                  '_`--pipeline` は自動付与されます。_'
              }
            }
          ]
        };
      }

      if (!this.toolClient.hasTool('takt')) {
        return {
          text: '❌ takt ツールが登録されていません。設定を確認してください。'
        };
      }

      const isAvailable = await this.toolClient.checkAvailability('takt');
      if (!isAvailable) {
        return {
          text: '❌ takt CLI が見つかりません。`npm install -g takt` でインストールしてください。'
        };
      }

      const resolvedRepository = await this.resolveChannelRepository(message.channelId);
      if (resolvedRepository.error) {
        return {
          text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
        };
      }

      const repo = resolvedRepository.repository;
      const workingDirectory = repo?.localPath;

      // Parse takt-specific options from the input.
      // Recognized flags: --auto-pr, --draft, --provider <v>, --piece/-w <v>, --model <v>,
      //                    --branch/-b <v>, --skip-git, --quiet/-q
      const input = message.text.trim();
      const taktFlags: string[] = [];
      const promptParts: string[] = [];
      const tokens = input.split(/\s+/);
      const flagsWithValue = new Set(['--provider', '--piece', '-w', '--model', '--branch', '-b']);
      const flagsBoolean = new Set(['--auto-pr', '--draft', '--skip-git', '--quiet', '-q']);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (flagsWithValue.has(token) && i + 1 < tokens.length) {
          taktFlags.push(token, tokens[++i]);
        } else if (flagsBoolean.has(token)) {
          taktFlags.push(token);
        } else {
          promptParts.push(token);
        }
      }

      const taskPrompt = promptParts.join(' ');
      if (!taskPrompt) {
        return {
          text: '❌ タスク内容を指定してください。例: `/takt-run バグを修正してください`'
        };
      }

      logger.info('Executing takt-run command', {
        channelId: message.channelId,
        taktFlags,
        taskPrompt: taskPrompt.slice(0, 100),
        workingDirectory
      });

      const result = await this.toolClient.sendPrompt(taskPrompt, {
        workingDirectory,
        toolName: 'takt',
        extraArgs: taktFlags.length > 0 ? taktFlags : undefined
      });

      if (result.error) {
        return {
          text: `❌ [takt] ${result.error}`
        };
      }

      if (!result.response?.trim()) {
        return {
          text: '⚠️ [takt] タスクは実行されましたが、表示可能な応答がありませんでした。'
        };
      }

      return {
        text: result.response,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*🎵 takt:*\n${result.response}`
            }
          }
        ]
      };
    });

    // /orcha-run: orcha を対象リポジトリの cwd で実行し、.orcha/ は本プロジェクトのものを使う
    registerCommandAliases(['orcha-run'], async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text?.trim()) {
        return {
          text: '📝 使い方',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*orcha 実行コマンド*\n\n' +
                  '• `/orcha-run <タスク>` - タスクを作成して orcha サイクルを実行\n' +
                  '• `/orcha-run --profile <name> <タスク>` - プロファイルを指定して実行\n' +
                  '• `/orcha-run --no-timeout <タスク>` - タイムアウトなしで実行\n' +
                  '• `/orcha-run --verbose <タスク>` - 詳細ログ付きで実行\n' +
                  '• `/orcha-run status` - 現在のステータスを表示\n\n' +
                  '_`.orcha/` 設定は本プロジェクトのものを使用し、対象リポジトリの cwd で実行します。_'
              }
            }
          ]
        };
      }

      const orchaCommand = process.env.ORCHA_COMMAND || 'orcha';
      const orchaDirSource = path.resolve(process.cwd(), '.orcha');

      if (!fs.existsSync(orchaDirSource)) {
        return {
          text: '❌ `.orcha/` ディレクトリが見つかりません。`orcha init` で初期化してください。'
        };
      }

      // Resolve target repository
      const resolvedRepository = await this.resolveChannelRepository(message.channelId);
      if (resolvedRepository.error) {
        return {
          text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
        };
      }

      const repo = resolvedRepository.repository;
      if (!repo?.localPath) {
        return {
          text: '❌ このチャンネルにリポジトリがリンクされていません。先に `/agent-repo <URL>` でリポジトリを設定してください。'
        };
      }
      const workingDirectory = path.resolve(repo.localPath);

      // Copy .orcha/ into the target repository so orcha operates in-place.
      // Always re-sync orcha.yml from source so config changes are picked up.
      const orchaDirTarget = path.join(workingDirectory, '.orcha');
      if (!fs.existsSync(orchaDirTarget)) {
        this.copyDirSync(orchaDirSource, orchaDirTarget);
        logger.info('Copied .orcha/ into target repository', {
          source: orchaDirSource,
          target: orchaDirTarget
        });
      } else {
        // Re-sync orcha.yml from source
        const srcYml = path.join(orchaDirSource, 'orcha.yml');
        const destYml = path.join(orchaDirTarget, 'orcha.yml');
        if (fs.existsSync(srcYml)) {
          fs.copyFileSync(srcYml, destYml);
        }
      }
      // Always patch for Windows (idempotent)
      this.patchOrchaYmlForWindows(orchaDirTarget);

      // Parse flags and task content
      const input = message.text.trim();

      // Handle "status" subcommand
      if (input === 'status') {
        return this.executeOrchaStatus(orchaDirTarget);
      }

      const orchaFlags: string[] = [];
      const promptParts: string[] = [];
      const tokens = input.split(/\s+/);
      const flagsWithValue = new Set(['--profile']);
      const flagsBoolean = new Set(['--no-timeout', '--verbose', '-v', '--reset-cycle', '--enforce-lock']);

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (flagsWithValue.has(token) && i + 1 < tokens.length) {
          orchaFlags.push(token, tokens[++i]);
        } else if (flagsBoolean.has(token)) {
          orchaFlags.push(token);
        } else {
          promptParts.push(token);
        }
      }

      const taskContent = promptParts.join(' ');
      if (!taskContent) {
        return {
          text: '❌ タスク内容を指定してください。例: `/orcha-run バグを修正してください`'
        };
      }

      // Handle --profile flag: switch active profile in orcha.yml if specified
      const profileIndex = orchaFlags.indexOf('--profile');
      if (profileIndex >= 0 && profileIndex + 1 < orchaFlags.length) {
        const profileName = orchaFlags[profileIndex + 1];
        this.updateOrchaProfile(orchaDirTarget, profileName);
        // Remove --profile from orchaFlags (it's applied via config, not CLI arg)
        orchaFlags.splice(profileIndex, 2);
      }

      // Create task file in .orcha/tasks/open/
      const taskId = `T${Date.now()}`;
      const taskFileName = `${taskId}.md`;
      const tasksOpenDir = path.join(orchaDirTarget, 'tasks', 'open');
      if (!fs.existsSync(tasksOpenDir)) {
        fs.mkdirSync(tasksOpenDir, { recursive: true });
      }
      const taskFilePath = path.join(tasksOpenDir, taskFileName);
      const taskFileContent =
        `---\nid: ${taskId}\ntitle: "${taskContent.slice(0, 80).replace(/"/g, '\\"')}"\nowner: discord\ncreated: ${new Date().toISOString()}\n---\n\n## Description\n\n${taskContent}\n`;
      fs.writeFileSync(taskFilePath, taskFileContent, 'utf-8');

      logger.info('Created orcha task file', {
        channelId: message.channelId,
        taskId,
        taskFilePath,
        workingDirectory
      });

      // Build orcha run args
      const args = ['run', '--reset-cycle', ...orchaFlags];

      logger.info('Executing orcha run', {
        channelId: message.channelId,
        orchaCommand,
        args,
        workingDirectory,
        orchaDir: orchaDirTarget
      });

      // Execute orcha run
      const noTimeout = orchaFlags.includes('--no-timeout');

      return new Promise<BotResponse>((resolve) => {
        let stdout = '';
        let stderr = '';

        const orchaProcess = spawn(orchaCommand, args, {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
          windowsHide: true,
          env: {
            ...process.env,
            LANG: 'ja_JP.UTF-8',
            LC_ALL: 'ja_JP.UTF-8',
            PYTHONIOENCODING: 'utf-8',
          }
        });

        // stdin を即座に閉じて待機を防止（Windows cmd.exe 経由で必要）
        if (orchaProcess.stdin) {
          orchaProcess.stdin.end();
        }

        let timeoutId: NodeJS.Timeout | undefined;
        if (!noTimeout) {
          timeoutId = setTimeout(() => {
            orchaProcess.kill('SIGTERM');
            resolve({
              text: `⏱️ [orcha] タイムアウトしました。バックグラウンドで処理を継続している可能性があります。\n\`/orcha-run status\` で状態を確認してください。`
            });
          }, ConfigLoader.get('claude.timeout', 3600000));
        }

        orchaProcess.stdout?.on('data', (data) => {
          stdout += data.toString('utf8');
        });

        orchaProcess.stderr?.on('data', (data) => {
          stderr += data.toString('utf8');
        });

        orchaProcess.on('close', (code) => {
          if (timeoutId) clearTimeout(timeoutId);

          if (code === 0) {
            // Read the status.md for a summary
            const statusSummary = this.readOrchaStatusSummary(orchaDirTarget);
            const outputPreview = stdout.trim().slice(-2000) || '(出力なし)';
            resolve({
              text: statusSummary,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `*🎼 orcha 完了 (タスク: ${taskId})*\n\n${statusSummary}\n\n*出力 (末尾):*\n\`\`\`\n${outputPreview.slice(0, 1500)}\n\`\`\``
                  }
                }
              ]
            });
          } else {
            const errorPreview = (stderr.trim() || stdout.trim()).slice(0, 1500);
            resolve({
              text: `❌ [orcha] 終了コード ${code} で失敗しました`,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `❌ *orcha* がエラーコード ${code} で終了しました\n\n\`\`\`\n${errorPreview}\n\`\`\``
                  }
                }
              ]
            });
          }
        });

        orchaProcess.on('error', (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (err.message.includes('ENOENT')) {
            resolve({
              text: `❌ orcha CLI が見つかりません。インストールとPATH設定を確認してください。`
            });
          } else {
            resolve({
              text: `❌ [orcha] プロセス起動エラー: ${err.message}`
            });
          }
        });
      });
    });

    registerCommandAliases(['agent-help', 'claude-help'], async (): Promise<BotResponse | null> => {
      return {
        text: 'Agent Chatbot ヘルプ',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*利用可能なコマンド:*\n\n' +
                '• `/agent <プロンプト>` - 現在の既定ツールで実行\n' +
                '• `/agent --tool <name> <プロンプト>` - 1回だけツールを切り替えて実行\n' +
                '• `/agent-tool status` - 現在の有効ツールを表示\n' +
                '• `/agent-tool list` - 設定済みツール一覧とCLI検出状態を表示\n' +
                '• `/agent-tool use <name>` - このチャンネルの既定ツールを設定\n' +
                '• `/agent-tool clear` - このチャンネルの固定設定を解除（全体既定へ）\n' +
                '• `/agent-tool reset` - 全チャンネルの固定設定を一括削除（全体既定に戻す）\n' +
                '• `/takt-run <タスク>` - TAKT パイプラインモードでタスク実行\n' +
                '• `/orcha-run <タスク>` - orcha サイクルでタスク実行\n' +
                '• `/agent-repo <URL>` - Gitリポジトリをクローンしてチャンネルにリンク\n' +
                '• `/agent-repo status` - 現在のリポジトリ状態を確認\n' +
                '• `/agent-repo create <name>` - 新規Gitリポジトリを作成してリンク\n' +
                '• `/agent-repo tool <name>` - このチャンネル(=リポジトリ)の既定ツールを設定\n' +
                '• `/agent-repo delete` - このチャンネルのリポジトリリンクを削除\n' +
                '• `/agent-repo reset` - すべてのリポジトリリンクをリセット\n' +
                '• `/agent-status` - ツールCLIとリポジトリの状態を確認\n' +
                '• `/agent-clear` - 会話継続状態をクリア\n' +
                '• `/agent-help` - このヘルプを表示'
            }
          }
        ]
      };
    });

    registerCommandAliases(['agent-status', 'claude-status'], async (message: BotMessage): Promise<BotResponse | null> => {
      const currentTool = this.getEffectiveToolName(message.channelId);
      const isAvailable = await this.toolClient.checkAvailability(currentTool);
      const resolvedRepository = await this.resolveChannelRepository(message.channelId);

      if (resolvedRepository.error) {
        return {
          text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
        };
      }

      const repo = resolvedRepository.repository;

      let statusText = `*有効ツール:* \`${currentTool}\` ${isAvailable ? '✅ 利用可能' : '❌ 利用不可'}\n`;
      statusText += `*チャンネルID:* ${message.channelId}\n`;

      if (repo) {
        statusText += `*リンクされたリポジトリ:* ${repo.repositoryUrl}\n`;
        statusText += `*リポジトリパス:* ${repo.localPath}`;
        if (resolvedRepository.restored) {
          statusText += '\n*補足:* localPath が存在しなかったため再クローンしました';
        }
      } else {
        statusText += '*リンクされたリポジトリ:* なし';
      }

      return {
        text: 'システムステータス',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: statusText
            }
          }
        ]
      };
    });

    registerCommandAliases(['agent-clear', 'claude-clear'], async (message: BotMessage): Promise<BotResponse | null> => {
      const clearedConversationCount = this.clearConversationState(message.channelId);
      return {
        text: '🧹 会話コンテキストをクリアしました',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
                `✅ 新しい会話を開始できます。\n` +
                `クリア対象: ${clearedConversationCount}件の会話状態\n\n` +
                '_次回メッセージは新規セッションとして実行されます。_'
            }
          }
        ]
      };
    });

    registerCommandAliases(['agent-skip-permissions', 'claude-skip-permissions'], async (message: BotMessage): Promise<BotResponse | null> => {
      const action = message.text?.trim().toLowerCase();

      if (action === 'on' || action === 'enable') {
        this.skipPermissionsEnabled = true;
      } else if (action === 'off' || action === 'disable') {
        this.skipPermissionsEnabled = false;
      } else if (!action || action === '') {
        this.skipPermissionsEnabled = !this.skipPermissionsEnabled;
      } else {
        return {
          text: '❌ 無効なパラメータです',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '**使用方法:**\n' +
                  '• `/agent-skip-permissions` - 現在の設定を切り替え\n' +
                  '• `/agent-skip-permissions on` - 有効化\n' +
                  '• `/agent-skip-permissions off` - 無効化'
              }
            }
          ]
        };
      }

      const statusEmoji = this.skipPermissionsEnabled ? '🔓' : '🔒';
      const statusText = this.skipPermissionsEnabled ? '有効' : '無効';

      return {
        text: `${statusEmoji} --dangerously-skip-permissions が${statusText}になりました`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `**権限スキップモード:** ${statusEmoji} ${statusText}\n\n` +
                (this.skipPermissionsEnabled
                  ? '⚠️ **警告:** このモードでは、対応ツールはファイルシステムへの広いアクセス権を持ちます。信頼できる環境でのみ使用してください。'
                  : '✅ 通常モードで動作しています。ツールは制限された権限で実行されます。')
            }
          }
        ]
      };
    });

    registerCommandAliases(['agent-repo', 'claude-repo'], async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '📝 使い方：`/agent-repo create <name>` で作成、`/agent-repo <URL>` でクローン、`/agent-repo status` で状態確認',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*リポジトリ管理コマンド*\n\n' +
                  '• `/agent-repo create <name>` - 新しいリポジトリを作成してチャンネルに紐付け\n' +
                  '• `/agent-repo <リポジトリ URL>` - リポジトリをクローンしてチャンネルに紐付け\n' +
                  '• `/agent-repo status` - 現在のリポジトリ状態を確認\n' +
                  '• `/agent-repo tool <name>` - このチャンネル (=リポジトリ) の既定ツールを設定\n' +
                  '• `/agent-repo delete` - チャンネルとリポジトリの紐付けを削除'
              }
            }
          ]
        };
      }

      const rawArgs = message.text.trim();
      const args = rawArgs.toLowerCase();

      if (args === 'tool') {
        return {
          text: '❌ ツール名を指定してください。例：`/agent-repo tool vibe-local`'
        };
      }

      if (args.startsWith('tool ')) {
        const requestedTool = rawArgs.split(/\s+/, 2)[1]?.trim();
        if (!requestedTool) {
          return {
            text: '❌ ツール名を指定してください。例：`/agent-repo tool codex`'
          };
        }

        const toolName = requestedTool.toLowerCase();

        if (!this.toolClient.hasTool(toolName)) {
          return this.getUnknownToolResponse(toolName);
        }

        this.toolPreferenceService.setChannelTool(message.channelId, toolName);
        const repo = this.storageService.getChannelRepository(message.channelId);

        return {
          text: `✅ このチャンネル (=リポジトリ) の既定ツールを \`${toolName}\` に設定しました`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*既定ツールを更新しました*\n\n` +
                  `チャンネル ID: ${message.channelId}\n` +
                  `既定ツール：\`${toolName}\`\n` +
                  `リンク済みリポジトリ：${repo ? repo.repositoryUrl : '未設定'}`
              }
            }
          ]
        };
      }

      if (args === 'status') {
        const resolvedRepository = await this.resolveChannelRepository(message.channelId);
        if (resolvedRepository.error) {
          return {
            text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました：${resolvedRepository.error}`
          };
        }

        const repo = resolvedRepository.repository;
        if (!repo) {
          return {
            text: '❌ このチャンネルにはリポジトリが設定されていません'
          };
        }

        const effectiveTool = this.getEffectiveToolName(message.channelId);

        const status = await this.gitService.getRepositoryStatus(repo.localPath);
        if (!status.success) {
          return {
            text: `❌ リポジトリの状態を取得できませんでした：${status.error}`
          };
        }

        return {
          text: `リポジトリ：${repo.repositoryUrl}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*リポジトリ情報*\n\n` +
                  `URL: ${repo.repositoryUrl}\n` +
                  `有効ツール：\`${effectiveTool}\`\n` +
                  `クローン日時：${new Date(repo.createdAt).toLocaleString('ja-JP')}\n` +
                  `${resolvedRepository.restored ? '補足：localPath が存在しなかったため再クローンしました\n' : ''}\n` +
                  `*Git 状態*\n\`\`\`${status.status}\`\`\``
              }
            }
          ]
        };
      }

      if (args === 'delete') {
        const deleted = this.storageService.deleteChannelRepository(message.channelId);
        if (deleted) {
          const clearedConversationCount = this.clearConversationState(message.channelId);
          return {
            text:
              `✅ チャンネルとリポジトリの紐付けを削除しました` +
              `（会話状態 ${clearedConversationCount} 件をクリア）`
          };
        }
        return {
          text: '❌ このチャンネルにはリポジトリが設定されていません'
        };
      }

      if (args === 'reset') {
        const channels = this.storageService.getAllChannelRepositories();
        const channelCount = Object.keys(channels).length;

        if (channelCount === 0) {
          return {
            text: '❌ 現在リポジトリが紐付けられているチャンネルはありません'
          };
        }

        for (const channelId of Object.keys(channels)) {
          this.storageService.deleteChannelRepository(channelId);
          this.clearConversationState(channelId);
        }

        return {
          text: `✅ ${channelCount}個のチャンネルのリポジトリ紐付けをすべて削除しました`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*リポジトリ関係のリセット完了*\n\n` +
                  `削除されたチャンネル数：${channelCount}\n\n` +
                  'すべてのチャンネルのリポジトリ紐付けが削除されました。'
              }
            }
          ]
        };
      }

      if (args.startsWith('create ')) {
        const repoName = rawArgs.split(/\s+/, 2)[1]?.trim();
        if (!repoName) {
          return {
            text: '❌ リポジトリ名を指定してください。例：`/agent-repo create my-project`'
          };
        }

        if (this.storageService.isRepositoryNameExists(repoName)) {
          return {
            text: `❌ 同じ名前のリポジトリが既に存在します：${repoName}`
          };
        }

        const createResult = await this.gitService.createRepository(repoName, message.channelId);
        if (!createResult.success) {
          return {
            text: `❌ リポジトリの作成に失敗しました：${createResult.error}`
          };
        }

        this.storageService.setChannelRepository(message.channelId, `local://${repoName}`, createResult.localPath!);
        const clearedConversationCount = this.clearConversationState(message.channelId);

        return {
          text: '✅ リポジトリを作成しました！',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*リポジトリの作成が完了しました*\n\n` +
                  `名前：${repoName}\n` +
                  `チャンネル：<#${message.channelId}>\n\n` +
                  `会話状態クリア：${clearedConversationCount}件\n\n` +
                  'これでこのチャンネルでツールを実行すると、このリポジトリのコンテキストで応答します。'
              }
            }
          ]
        };
      }

      // Handle URL clone (default case)
      if (/^https?:\/\//.test(args)) {
        const url = rawArgs.trim();

        // Derive repo name from URL for duplicate check before cloning
        let tempRepoName: string | null = null;
        try {
          const tempUrl = new URL(url);
          const pathParts = tempUrl.pathname.replace(/\.git$/, '').split('/');
          const lastPart = pathParts[pathParts.length - 1];
          if (lastPart) {
            tempRepoName = lastPart.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
          }
        } catch {}

        if (tempRepoName && this.storageService.isRepositoryNameExists(tempRepoName)) {
          return {
            text: `❌ 同じ名前のリポジトリが既に存在します：${tempRepoName}`
          };
        }

        const cloneResult = await this.gitService.cloneRepository(url, message.channelId);
        if (!cloneResult.success) {
          return {
            text: `❌ リポジトリのクローンに失敗しました：${cloneResult.error}`
          };
        }

        this.storageService.setChannelRepository(message.channelId, url, cloneResult.localPath!);
        const clearedConversationCount = this.clearConversationState(message.channelId);

        return {
          text: '✅ リポジトリをクローンしました！',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*リポジトリのクローンが完了しました*\n\n` +
                  `URL：${url}\n` +
                  `名前：${tempRepoName || 'unknown'}\n` +
                  `チャンネル：<#${message.channelId}>\n\n` +
                  `会話状態クリア：${clearedConversationCount}件\n\n` +
                  'これでこのチャンネルでツールを実行すると、このリポジトリのコンテキストで応答します。'
              }
            }
          ]
        };
      }

      return {
        text: '❌ 無効なコマンドです。`/agent-repo` を実行して使い方をご確認ください。',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*無効なコマンド*\n\n' +
                '使用法：`/agent-repo create <name>`、`/agent-repo <URL>`、`/agent-repo status` など\n\n' +
                '`/agent-repo` を実行して詳細を表示します。'
            }
          }
        ]
      };
    });
  }

  async startAll(): Promise<void> {
    await this.configLoadPromise;

    const agentDisplayName = this.resolveAgentDisplayName();
    this.bots.forEach(bot => bot.setAgentName?.(agentDisplayName));

    logger.info('Starting all bots');
    logger.info('Resolved runtime agent display name', { agentDisplayName });

    const tools = this.toolClient.listTools();
    const statuses = await Promise.all(
      tools.map(async (tool) => ({
        name: tool.name,
        available: await this.toolClient.checkAvailability(tool.name)
      }))
    );

    statuses.forEach(status => {
      logger.info('Tool CLI availability check', status);
      if (!status.available) {
        logger.warn(`Tool CLI not found`, { tool: status.name });
      }
    });

    await Promise.all(this.bots.map(bot => bot.start()));
    logger.info('All bots started', { count: this.bots.length });
  }

  async stopAll(): Promise<void> {
    logger.info('Stopping all bots');
    await Promise.all(this.bots.map(bot => bot.stop()));
    logger.info('All bots stopped', { count: this.bots.length });

    this.toolClient.cleanup();
    logger.debug('Tool client cleanup completed');
  }

  // --- orcha helpers ---

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Patch orcha.yml for Windows (idempotent).
   *
   * Problem: orcha.yml uses `command: "bash"` + `scripts/opencode-monitor.sh`
   * to spawn agents. On Windows, bash stdout is not valid UTF-8 for Rust's
   * String reader, and the monitor script path won't resolve in target repos.
   *
   * Solution: Replace all `bash` + shell-script entries with the direct CLI
   * command (`opencode-cli`). The monitor script's watchdog is redundant —
   * orcha's own `phase_timeout_seconds` handles timeouts.
   *
   * For any remaining `command: "bash"` entries (without the monitor script),
   * resolve them to `cmd.exe /c` with the equivalent command from the
   * system PATH.
   */
  private patchOrchaYmlForWindows(orchaDir: string): void {
    if (process.platform !== 'win32') return;

    const ymlPath = path.join(orchaDir, 'orcha.yml');
    if (!fs.existsSync(ymlPath)) return;

    let content = fs.readFileSync(ymlPath, 'utf-8');
    const originalContent = content;

    // 1. Replace: command: "bash" + args: ["scripts/opencode-monitor.sh", <remaining args...>]
    //    With:    command: "opencode-cli" + args: [<remaining args...>]
    //    The monitor script is just a wrapper around opencode-cli, so we skip it entirely.
    content = content.replace(
      /command:\s*"bash"\s*\n(\s*args:\s*\[)"scripts\/opencode-monitor\.sh",\s*/g,
      `command: "opencode-cli"\n$1`
    );

    // 2. Replace any remaining bare `command: "bash"` with `command: "cmd.exe"`
    //    and prepend "/c" to the args array so cmd.exe interprets the rest.
    content = content.replace(
      /command:\s*"bash"\s*\n(\s*args:\s*\[)/g,
      `command: "cmd.exe"\n$1"/c", `
    );

    if (content !== originalContent) {
      fs.writeFileSync(ymlPath, content, 'utf-8');
      logger.info('Patched orcha.yml for Windows: replaced bash with direct CLI commands', {
        orchaDir
      });
    }
  }

  private updateOrchaProfile(orchaDir: string, profileName: string): void {
    const ymlPath = path.join(orchaDir, 'orcha.yml');
    if (!fs.existsSync(ymlPath)) return;
    let content = fs.readFileSync(ymlPath, 'utf-8');
    content = content.replace(
      /^(\s*profile:\s*)"[^"]*"/m,
      `$1"${profileName}"`
    );
    content = content.replace(
      /^(\s*profile:\s*)(?!")[^\s#]+/m,
      `$1"${profileName}"`
    );
    fs.writeFileSync(ymlPath, content, 'utf-8');
    logger.info('Updated orcha profile', { orchaDir, profileName });
  }

  private readOrchaStatusSummary(orchaDir: string): string {
    const statusPath = path.join(orchaDir, 'agentworkspace', 'status.md');
    if (!fs.existsSync(statusPath)) {
      return '(status.md が見つかりません)';
    }
    const raw = fs.readFileSync(statusPath, 'utf-8');
    // Extract frontmatter
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return raw.slice(0, 500);

    const fm = fmMatch[1];
    const getField = (name: string): string => {
      const m = fm.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : '-';
    };

    return (
      `**Cycle:** ${getField('cycle')} | **Phase:** ${getField('phase')} | **Profile:** ${getField('profile')}\n` +
      `**Review:** ${getField('review_status')} | **Verify failures:** ${getField('consecutive_verify_failures')}`
    );
  }

  private executeOrchaStatus(orchaDir: string): BotResponse {
    const summary = this.readOrchaStatusSummary(orchaDir);
    return {
      text: summary,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🎼 orcha ステータス*\n\n${summary}`
          }
        }
      ]
    };
  }
}
