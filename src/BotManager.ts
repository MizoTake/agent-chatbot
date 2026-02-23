import { BotAdapter, BotMessage, BotResponse } from './interfaces/BotInterface';
import { SlackAdapter } from './adapters/SlackAdapter';
import { DiscordAdapter } from './adapters/DiscordAdapter';
import { ToolCLIClient, ToolConfig } from './toolCLIClient';
import { ChannelRepository, StorageService } from './services/StorageService';
import { ToolPreferenceService } from './services/ToolPreferenceService';
import { GitService } from './services/GitService';
import { createLogger } from './utils/logger';
import { ConfigLoader } from './config/configLoader';

const logger = createLogger('BotManager');

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
      const timeout = ConfigLoader.get('claude.timeout', 900000);
      const maxOutputSize = ConfigLoader.get('claude.maxOutputSize', 10485760);

      const configuredTools = ConfigLoader.get<Record<string, ToolConfig>>('tools.definitions', {});
      const mergedTools: Record<string, ToolConfig> = {
        claude: {
          command: claudeCommand,
          args: ['--dangerously-skip-permissions', '--print', '{prompt}'],
          versionArgs: ['--version'],
          description: 'Anthropic Claude CLI',
          supportsSkipPermissions: true
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
    if (channelTool && this.toolClient.hasTool(channelTool)) {
      return channelTool;
    }

    return this.toolClient.getDefaultToolName();
  }

  private getToolNames(): string[] {
    return this.toolClient.listTools().map(tool => tool.name);
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

    const result = await this.toolClient.sendPrompt(parsed.prompt, {
      workingDirectory,
      onBackgroundComplete,
      skipPermissions: this.skipPermissionsEnabled,
      toolName
    });

    if (result.error) {
      return {
        text: `❌ [${toolName}] ${result.error}`
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
        return {
          text: 'ツール設定ステータス',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*現在の有効ツール:* \`${currentTool}\` (${currentAvailable ? '✅ 利用可能' : '❌ 未検出'})\n` +
                  `*チャンネル固定ツール:* ${channelTool ? `\`${channelTool}\`` : '未設定'}\n` +
                  `*デフォルトツール:* \`${defaultTool}\`\n` +
                  `*利用可能候補:* ${availableTools.map(tool => `\`${tool.name}\``).join(', ')}`
              }
            }
          ]
        };
      }

      if (action === 'use') {
        if (!value) {
          return {
            text: '❌ 使用するツール名を指定してください。例: `/agent-tool use codex`'
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
        return {
          text: cleared
            ? '✅ チャンネル固定ツール設定を削除しました（デフォルトに戻りました）'
            : 'ℹ️ チャンネル固定ツールは設定されていません'
        };
      }

      return {
        text:
          '❌ 無効なサブコマンドです。\n' +
          '使用方法: `/agent-tool status` `/agent-tool list` `/agent-tool use <tool>` `/agent-tool clear`'
      };
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
                '• `/agent-tool clear` - チャンネル既定を解除（全体既定へ）\n' +
                '• `/agent-repo <URL>` - Gitリポジトリをクローンしてチャンネルにリンク\n' +
                '• `/agent-repo status` - 現在のリポジトリ状態を確認\n' +
                '• `/agent-repo tool <name>` - このチャンネル(=リポジトリ)の既定ツールを設定\n' +
                '• `/agent-repo delete` - このチャンネルのリポジトリリンクを削除\n' +
                '• `/agent-repo reset` - すべてのリポジトリリンクをリセット\n' +
                '• `/agent-status` - ツールCLIとリポジトリの状態を確認\n' +
                '• `/agent-clear` - 会話のコンテキストをクリア\n' +
                '• `/agent-help` - このヘルプを表示\n\n' +
                '_互換エイリアスとして `/claude*` 系コマンドも利用できます。_'
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

    registerCommandAliases(['agent-clear', 'claude-clear'], async (): Promise<BotResponse | null> => {
      return {
        text: '🧹 会話コンテキストをクリアしました',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '✅ 新しい会話を開始できます。\n\n' +
                '_注: 現在の実装では各メッセージは独立して処理されます。_'
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
          text: '📝 使い方: `/agent-repo <リポジトリURL>` でクローン、`/agent-repo status` で状態確認、`/agent-repo tool <name>` で既定ツール設定',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*リポジトリ管理コマンド*\n\n' +
                  '• `/agent-repo <リポジトリURL>` - リポジトリをクローンしてチャンネルに紐付け\n' +
                  '• `/agent-repo status` - 現在のリポジトリ状態を確認\n' +
                  '• `/agent-repo tool <name>` - このチャンネル(=リポジトリ)の既定ツールを設定\n' +
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
          text: '❌ ツール名を指定してください。例: `/agent-repo tool vibe-local`'
        };
      }

      if (args.startsWith('tool ')) {
        const requestedTool = rawArgs.split(/\s+/, 2)[1]?.trim();
        if (!requestedTool) {
          return {
            text: '❌ ツール名を指定してください。例: `/agent-repo tool codex`'
          };
        }

        const toolName = requestedTool.toLowerCase();

        if (!this.toolClient.hasTool(toolName)) {
          return this.getUnknownToolResponse(toolName);
        }

        this.toolPreferenceService.setChannelTool(message.channelId, toolName);
        const repo = this.storageService.getChannelRepository(message.channelId);

        return {
          text: `✅ このチャンネル(=リポジトリ)の既定ツールを \`${toolName}\` に設定しました`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `*既定ツールを更新しました*\n\n` +
                  `チャンネルID: ${message.channelId}\n` +
                  `既定ツール: \`${toolName}\`\n` +
                  `リンク済みリポジトリ: ${repo ? repo.repositoryUrl : '未設定'}`
              }
            }
          ]
        };
      }

      if (args === 'status') {
        const resolvedRepository = await this.resolveChannelRepository(message.channelId);
        if (resolvedRepository.error) {
          return {
            text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
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
            text: `❌ リポジトリの状態を取得できませんでした: ${status.error}`
          };
        }

        return {
          text: `リポジトリ: ${repo.repositoryUrl}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*リポジトリ情報*\n\n` +
                  `URL: ${repo.repositoryUrl}\n` +
                  `有効ツール: \`${effectiveTool}\`\n` +
                  `クローン日時: ${new Date(repo.createdAt).toLocaleString('ja-JP')}\n` +
                  `${resolvedRepository.restored ? '補足: localPath が存在しなかったため再クローンしました\n' : ''}\n` +
                  `*Git状態*\n\`\`\`${status.status}\`\`\``
              }
            }
          ]
        };
      }

      if (args === 'delete') {
        const deleted = this.storageService.deleteChannelRepository(message.channelId);
        if (deleted) {
          return {
            text: '✅ チャンネルとリポジトリの紐付けを削除しました'
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
        }

        return {
          text: `✅ ${channelCount}個のチャンネルのリポジトリ紐付けをすべて削除しました`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*リポジトリ関係のリセット完了*\n\n` +
                  `削除されたチャンネル数: ${channelCount}\n\n` +
                  'すべてのチャンネルのリポジトリ紐付けが削除されました。'
              }
            }
          ]
        };
      }

      const repoUrl = message.text.trim();
      if (!repoUrl.match(/^(https?:\/\/|git@)/)) {
        return {
          text: '❌ 有効なリポジトリURLを入力してください（HTTPSまたはSSH形式）'
        };
      }

      const cloneResult = await this.gitService.cloneRepository(repoUrl, message.channelId);
      if (!cloneResult.success) {
        return {
          text: `❌ リポジトリのクローンに失敗しました: ${cloneResult.error}`
        };
      }

      this.storageService.setChannelRepository(message.channelId, repoUrl, cloneResult.localPath!);

      return {
        text: '✅ リポジトリをクローンしました！',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*リポジトリのクローンが完了しました*\n\n` +
                `URL: ${repoUrl}\n` +
                `チャンネル: <#${message.channelId}>\n\n` +
                'これでこのチャンネルでツールを実行すると、このリポジトリのコンテキストで応答します。'
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
}
