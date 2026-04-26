import { BotAdapter, BotMessage, BotResponse } from '../interfaces/BotInterface';
import { ConfigValidator } from '../config/validator';
import { createLogger } from '../utils/logger';
import { ChannelContextService } from './ChannelContextService';
import { ConversationSessionService } from './ConversationSessionService';
import { PromptExecutionService } from './PromptExecutionService';
import { ToolRuntimeService } from './ToolRuntimeService';
import { WorkflowRunnerService } from './WorkflowRunnerService';

const logger = createLogger('BotCommandService');

export class BotCommandService {
  constructor(
    private readonly promptExecutionService: PromptExecutionService,
    private readonly workflowRunnerService: WorkflowRunnerService,
    private readonly toolRuntimeService: ToolRuntimeService,
    private readonly channelContextService: ChannelContextService,
    private readonly conversationSessionService: ConversationSessionService
  ) {}

  register(bot: BotAdapter): void {
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

      return this.promptExecutionService.executePromptRequest(
        message,
        false,
        (response) => bot.sendMessage(message.channelId, response)
      );
    });

    registerCommandAliases(['agent', 'claude'], async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '📝 Please provide a prompt. Usage: `/agent <your prompt>` or `/agent --tool <tool> <your prompt>`'
        };
      }

      return this.promptExecutionService.executePromptRequest(
        message,
        true,
        (response) => bot.sendMessage(message.channelId, response)
      );
    });

    registerCommandAliases(['agent-tool', 'claude-tool'], async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleToolCommand(message);
    });

    registerCommandAliases(['takt-run'], async (message: BotMessage): Promise<BotResponse | null> => {
      return this.workflowRunnerService.runTakt(message);
    });

    registerCommandAliases(['orcha-run'], async (message: BotMessage): Promise<BotResponse | null> => {
      return this.workflowRunnerService.runOrcha(message);
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
      return this.handleStatusCommand(message);
    });

    registerCommandAliases(['agent-clear', 'claude-clear'], async (message: BotMessage): Promise<BotResponse | null> => {
      const clearedConversationCount = this.conversationSessionService.clearConversationState(message.channelId);
      return {
        text: '🧹 会話コンテキストをクリアしました',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ 新しい会話を開始できます。\nクリア対象: ${clearedConversationCount}件の会話状態\n\n_次回メッセージは新規セッションとして実行されます。_`
            }
          }
        ]
      };
    });

    registerCommandAliases(['agent-skip-permissions', 'claude-skip-permissions'], async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleSkipPermissionsCommand(message);
    });

    registerCommandAliases(['agent-repo', 'claude-repo'], async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleRepositoryCommand(message);
    });
  }

  private async handleToolCommand(message: BotMessage): Promise<BotResponse | null> {
    const toolClient = this.toolRuntimeService.getToolClient();
    const input = message.text?.trim() || 'status';
    const [action, value] = input.split(/\s+/, 2);
    const availableTools = toolClient.listTools();
    const currentTool = this.channelContextService.getEffectiveToolName(message.channelId, toolClient);
    const channelTool = this.channelContextService.getChannelToolPreference(message.channelId)?.toolName;

    if (action === 'list') {
      const statuses = await Promise.all(
        availableTools.map(async (tool) => ({
          tool,
          available: await toolClient.checkAvailability(tool.name)
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
      const currentAvailable = await toolClient.checkAvailability(currentTool);
      const defaultTool = toolClient.getDefaultToolName();
      const channelToolStale = channelTool && !toolClient.hasTool(channelTool);
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
      if (!toolClient.hasTool(value)) {
        return this.channelContextService.buildUnknownToolResponse(value, toolClient);
      }

      this.channelContextService.setChannelTool(message.channelId, value);
      return {
        text: `✅ このチャンネルの既定ツールを \`${value}\` に設定しました`
      };
    }

    if (action === 'clear') {
      const cleared = this.channelContextService.clearChannelTool(message.channelId);
      const defaultTool = toolClient.getDefaultToolName();
      return {
        text: cleared
          ? `✅ チャンネル固定ツール設定を削除しました（デフォルト: \`${defaultTool}\` に戻りました）`
          : `ℹ️ チャンネル固定ツールは設定されていません（デフォルト: \`${defaultTool}\`）`
      };
    }

    if (action === 'reset') {
      const count = this.channelContextService.clearAllChannelTools();
      const defaultTool = toolClient.getDefaultToolName();
      return {
        text: count > 0
          ? `✅ 全チャンネルのツール固定設定を削除しました（${count}件 → デフォルト: \`${defaultTool}\`）`
          : `ℹ️ 固定ツール設定は1件もありませんでした（デフォルト: \`${defaultTool}\`）`
      };
    }

    return {
      text: '❌ 無効なサブコマンドです。\n使用方法: `/agent-tool status` `/agent-tool list` `/agent-tool use <tool>` `/agent-tool clear` `/agent-tool reset`'
    };
  }

  private async handleStatusCommand(message: BotMessage): Promise<BotResponse | null> {
    const toolClient = this.toolRuntimeService.getToolClient();
    const currentTool = this.channelContextService.getEffectiveToolName(message.channelId, toolClient);
    const isAvailable = await toolClient.checkAvailability(currentTool);
    const resolvedRepository = await this.channelContextService.resolveChannelRepository(message.channelId);
    if (resolvedRepository.error) {
      return {
        text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました: ${resolvedRepository.error}`
      };
    }

    const repository = resolvedRepository.repository;
    let statusText = `*有効ツール:* \`${currentTool}\` ${isAvailable ? '✅ 利用可能' : '❌ 利用不可'}\n`;
    statusText += `*チャンネルID:* ${message.channelId}\n`;
    if (repository) {
      statusText += `*リンクされたリポジトリ:* ${repository.repositoryUrl}\n`;
      statusText += `*リポジトリパス:* ${repository.localPath}`;
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
  }

  private async handleSkipPermissionsCommand(message: BotMessage): Promise<BotResponse | null> {
    const action = message.text?.trim().toLowerCase();
    if (action === 'on' || action === 'enable') {
      this.toolRuntimeService.setSkipPermissionsEnabled(true);
    } else if (action === 'off' || action === 'disable') {
      this.toolRuntimeService.setSkipPermissionsEnabled(false);
    } else if (!action) {
      this.toolRuntimeService.toggleSkipPermissions();
    } else {
      return {
        text: '❌ 無効なパラメータです',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '**使用方法:**\n• `/agent-skip-permissions` - 現在の設定を切り替え\n• `/agent-skip-permissions on` - 有効化\n• `/agent-skip-permissions off` - 無効化'
            }
          }
        ]
      };
    }

    const enabled = this.toolRuntimeService.isSkipPermissionsEnabled();
    const statusEmoji = enabled ? '🔓' : '🔒';
    const statusText = enabled ? '有効' : '無効';
    return {
      text: `${statusEmoji} --dangerously-skip-permissions が${statusText}になりました`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `**権限スキップモード:** ${statusEmoji} ${statusText}\n\n` +
              (enabled
                ? '⚠️ **警告:** このモードでは、対応ツールはファイルシステムへの広いアクセス権を持ちます。信頼できる環境でのみ使用してください。'
                : '✅ 通常モードで動作しています。ツールは制限された権限で実行されます。')
          }
        }
      ]
    };
  }

  private async handleRepositoryCommand(message: BotMessage): Promise<BotResponse | null> {
    const toolClient = this.toolRuntimeService.getToolClient();
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
      if (!toolClient.hasTool(toolName)) {
        return this.channelContextService.buildUnknownToolResponse(toolName, toolClient);
      }

      this.channelContextService.setChannelTool(message.channelId, toolName);
      const repository = this.channelContextService.getChannelRepository(message.channelId);
      return {
        text: `✅ このチャンネル (=リポジトリ) の既定ツールを \`${toolName}\` に設定しました`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*既定ツールを更新しました*\n\nチャンネル ID: ${message.channelId}\n既定ツール：\`${toolName}\`\nリンク済みリポジトリ：${repository ? repository.repositoryUrl : '未設定'}`
            }
          }
        ]
      };
    }

    if (args === 'status') {
      const resolvedRepository = await this.channelContextService.resolveChannelRepository(message.channelId);
      if (resolvedRepository.error) {
        return {
          text: `❌ リポジトリのローカルパスが見つからず、再クローンに失敗しました：${resolvedRepository.error}`
        };
      }

      const repository = resolvedRepository.repository;
      if (!repository) {
        return {
          text: '❌ このチャンネルにはリポジトリが設定されていません'
        };
      }

      const effectiveTool = this.channelContextService.getEffectiveToolName(message.channelId, toolClient);
      const status = await this.channelContextService.getRepositoryStatus(repository.localPath);
      if (!status.success) {
        return {
          text: `❌ リポジトリの状態を取得できませんでした：${status.error}`
        };
      }

      return {
        text: `リポジトリ：${repository.repositoryUrl}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*リポジトリ情報*\n\nURL: ${repository.repositoryUrl}\n有効ツール：\`${effectiveTool}\`\nクローン日時：${new Date(repository.createdAt).toLocaleString('ja-JP')}\n${resolvedRepository.restored ? '補足：localPath が存在しなかったため再クローンしました\n' : ''}\n*Git 状態*\n\`\`\`${status.status}\`\`\``
            }
          }
        ]
      };
    }

    if (args === 'delete') {
      const deleted = this.channelContextService.deleteChannelRepository(message.channelId);
      if (deleted) {
        const clearedConversationCount = this.conversationSessionService.clearConversationState(message.channelId);
        return {
          text: `✅ チャンネルとリポジトリの紐付けを削除しました（会話状態 ${clearedConversationCount} 件をクリア）`
        };
      }
      return {
        text: '❌ このチャンネルにはリポジトリが設定されていません'
      };
    }

    if (args === 'reset') {
      const channels = this.channelContextService.getAllChannelRepositories();
      const channelIds = Object.keys(channels);
      if (channelIds.length === 0) {
        return {
          text: '❌ 現在リポジトリが紐付けられているチャンネルはありません'
        };
      }

      channelIds.forEach(channelId => {
        this.channelContextService.deleteChannelRepository(channelId);
        this.conversationSessionService.clearConversationState(channelId);
      });

      return {
        text: `✅ ${channelIds.length}個のチャンネルのリポジトリ紐付けをすべて削除しました`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*リポジトリ関係のリセット完了*\n\n削除されたチャンネル数：${channelIds.length}\n\nすべてのチャンネルのリポジトリ紐付けが削除されました。`
            }
          }
        ]
      };
    }

    if (args.startsWith('create ')) {
      const repositoryName = rawArgs.split(/\s+/, 2)[1]?.trim();
      if (!repositoryName) {
        return {
          text: '❌ リポジトリ名を指定してください。例：`/agent-repo create my-project`'
        };
      }
      if (this.channelContextService.isRepositoryNameExists(repositoryName)) {
        return {
          text: `❌ 同じ名前のリポジトリが既に存在します：${repositoryName}`
        };
      }

      const createResult = await this.channelContextService.createRepository(message.channelId, repositoryName);
      if (!createResult.success) {
        return {
          text: `❌ リポジトリの作成に失敗しました：${createResult.error}`
        };
      }

      const clearedConversationCount = this.conversationSessionService.clearConversationState(message.channelId);
      return {
        text: '✅ リポジトリを作成しました！',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*リポジトリの作成が完了しました*\n\n名前：${repositoryName}\nチャンネル：<#${message.channelId}>\n\n会話状態クリア：${clearedConversationCount}件\n\nこれでこのチャンネルでツールを実行すると、このリポジトリのコンテキストで応答します。`
            }
          }
        ]
      };
    }

    if (ConfigValidator.validateRepositoryUrl(rawArgs)) {
      const repositoryUrl = rawArgs.trim();
      const tempRepoName = this.extractRepositoryName(repositoryUrl);

      if (tempRepoName && this.channelContextService.isRepositoryNameExists(tempRepoName)) {
        return {
          text: `❌ 同じ名前のリポジトリが既に存在します：${tempRepoName}`
        };
      }

      const cloneResult = await this.channelContextService.cloneRepository(message.channelId, repositoryUrl);
      if (!cloneResult.success) {
        return {
          text: `❌ リポジトリのクローンに失敗しました：${cloneResult.error}`
        };
      }

      const clearedConversationCount = this.conversationSessionService.clearConversationState(message.channelId);
      return {
        text: '✅ リポジトリをクローンしました！',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*リポジトリのクローンが完了しました*\n\nURL：${repositoryUrl}\n名前：${tempRepoName || 'unknown'}\nチャンネル：<#${message.channelId}>\n\n会話状態クリア：${clearedConversationCount}件\n\nこれでこのチャンネルでツールを実行すると、このリポジトリのコンテキストで応答します。`
            }
          }
        ]
      };
    }

    logger.warn('Invalid repository command', { channelId: message.channelId, input: rawArgs });
    return {
      text: '❌ 無効なコマンドです。`/agent-repo` を実行して使い方をご確認ください。',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*無効なコマンド*\n\n使用法：`/agent-repo create <name>`、`/agent-repo <URL>`、`/agent-repo status` など\n\n`/agent-repo` を実行して詳細を表示します。'
          }
        }
      ]
    };
  }

  private extractRepositoryName(repositoryUrl: string): string | null {
    const normalizedUrl = repositoryUrl.trim().replace(/\/+$/, '');
    const match = normalizedUrl.match(/([^/:]+?)(?:\.git)?$/);
    if (!match?.[1]) {
      return null;
    }

    const repositoryName = match[1].toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    return repositoryName || null;
  }
}
