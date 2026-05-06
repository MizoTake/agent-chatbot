import { BOT_COMMANDS } from '../config/botCommands';
import { ConfigValidator } from '../config/validator';
import { BotAdapter, BotMessage, BotResponse } from '../interfaces/BotInterface';
import { createLogger } from '../utils/logger';
import { ApplicationUpdateService, ApplicationUpdateResult, RestartResult } from './ApplicationUpdateService';
import { ChannelContextService } from './ChannelContextService';
import { ConversationSessionService } from './ConversationSessionService';
import { PromptExecutionService } from './PromptExecutionService';
import { ToolRuntimeService } from './ToolRuntimeService';

const logger = createLogger('BotCommandService');

export class BotCommandService {
  constructor(
    private readonly promptExecutionService: PromptExecutionService,
    private readonly toolRuntimeService: ToolRuntimeService,
    private readonly channelContextService: ChannelContextService,
    private readonly conversationSessionService: ConversationSessionService,
    private readonly applicationUpdateService: ApplicationUpdateService
  ) {}

  register(bot: BotAdapter): void {
    const registerCommand = (
      command: string,
      handler: (message: BotMessage) => Promise<BotResponse | null>
    ): void => {
      bot.onCommand(command, handler);
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

    registerCommand(BOT_COMMANDS.agent, async (message: BotMessage): Promise<BotResponse | null> => {
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

    registerCommand(BOT_COMMANDS.codex, async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text && !message.attachments?.length) {
        return {
          text: '📝 プロンプトを指定してください。使用例: `/codex <プロンプト>`'
        };
      }

      return this.promptExecutionService.executePromptRequest(
        this.buildToolOverrideMessage(message, 'codex', message.text),
        true,
        (response) => bot.sendMessage(message.channelId, response)
      );
    });

    registerCommand(BOT_COMMANDS.goal, async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '📝 目標を指定してください。使用例: `/goal ログイン失敗を直す`'
        };
      }

      return this.promptExecutionService.executePromptRequest(
        this.buildToolOverrideMessage(message, 'codex', this.buildGoalPrompt(message.text)),
        true,
        (response) => bot.sendMessage(message.channelId, response)
      );
    });

    registerCommand(BOT_COMMANDS.tool, async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleToolCommand(message);
    });

    registerCommand(BOT_COMMANDS.codexModel, async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleCodexModelCommand(message);
    });

    registerCommand(BOT_COMMANDS.help, async (): Promise<BotResponse | null> => {
      return {
        text: 'Agent Chatbot ヘルプ',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*基本コマンド*\n' +
                '• `/agent <プロンプト>` - 現在の既定ツールで実行\n' +
                '• `/codex <プロンプト>` - Codex 固定で実行\n' +
                '• `/goal <目標>` - Codex に目標達成型の作業を依頼\n\n' +
                '*設定・状態確認*\n' +
                '• `/agent-status` - ツールCLIとリポジトリの状態を確認\n' +
                '• `/agent-clear` - 会話継続状態をクリア\n' +
                '• `/agent-tool status|list|use <name>|clear|reset` - 既定ツールを確認・変更\n' +
                '• `/codex-model status|use <model>|clear` - Codex モデルを確認・変更\n\n' +
                '*リポジトリ*\n' +
                '• `/agent-repo create <name>` - 新規Gitリポジトリを作成してリンク\n' +
                '• `/agent-repo <URL>` - Gitリポジトリをクローンしてリンク\n' +
                '• `/agent-repo status|tool <name>|delete|reset` - リポジトリ設定を確認・変更\n\n' +
                '*管理*\n' +
                '• `/agent-update [status|restart]` - アプリ本体を更新、状態確認、再起動予約\n' +
                '• `/agent-restart` - アプリ本体の再起動を予約'
            }
          }
        ]
      };
    });

    registerCommand(BOT_COMMANDS.status, async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleStatusCommand(message);
    });

    registerCommand(BOT_COMMANDS.clear, async (message: BotMessage): Promise<BotResponse | null> => {
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

    registerCommand(BOT_COMMANDS.repository, async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleRepositoryCommand(message);
    });

    registerCommand(BOT_COMMANDS.update, async (message: BotMessage): Promise<BotResponse | null> => {
      return this.handleUpdateCommand(message);
    });

    registerCommand(BOT_COMMANDS.restart, async (): Promise<BotResponse | null> => {
      return this.handleRestartCommand();
    });
  }

  private buildToolOverrideMessage(message: BotMessage, toolName: string, prompt: string): BotMessage {
    const trimmedPrompt = prompt.trim();
    return {
      ...message,
      text: trimmedPrompt ? `--tool ${toolName} ${trimmedPrompt}` : `--tool ${toolName}`
    };
  }

  private buildGoalPrompt(goal: string): string {
    return [
      '以下の目標を達成してください。Codex でリポジトリを確認し、必要な最小差分を実装し、実行可能な検証まで行ってください。',
      '',
      '進め方:',
      '1. 現状確認を行い、前提や不明点は仮定として明示する',
      '2. 目標達成に必要な最小の変更を行う',
      '3. 実行可能なテストまたは検証コマンドを実行する',
      '4. 変更内容と検証結果を日本語で簡潔に報告する',
      '',
      `目標:\n${goal.trim()}`
    ].join('\n');
  }

  private isValidCodexModelName(model: string): boolean {
    return /^[a-zA-Z0-9._/@:-]+$/.test(model) && model.length <= 120;
  }

  private handleCodexModelCommand(message: BotMessage): BotResponse {
    const input = message.text?.trim() || 'status';
    const [action, value] = input.split(/\s+/, 2);
    const currentModel = this.channelContextService.getChannelCodexModel(message.channelId);

    if (action === 'status') {
      return {
        text: currentModel
          ? `Codex モデル: \`${currentModel}\``
          : 'Codex モデルは未設定です（ツール設定または Codex CLI の既定値を使用します）'
      };
    }

    if (action === 'use' || action === 'set') {
      const model = value?.trim();
      if (!model) {
        return {
          text: '❌ Codex モデル名を指定してください。例: `/codex-model use gpt-5.4`'
        };
      }
      if (!this.isValidCodexModelName(model)) {
        return {
          text: '❌ Codex モデル名に使えない文字が含まれています。英数字、`.`、`_`、`-`、`/`、`@`、`:` のみ使用できます。'
        };
      }

      this.channelContextService.setChannelCodexModel(message.channelId, model);
      this.conversationSessionService.clearConversationState(message.channelId);
      return {
        text: `✅ このチャンネルの Codex モデルを \`${model}\` に設定しました。次回の Codex 実行から反映されます。`
      };
    }

    if (action === 'clear' || action === 'reset') {
      const cleared = this.channelContextService.clearChannelCodexModel(message.channelId);
      this.conversationSessionService.clearConversationState(message.channelId);
      return {
        text: cleared
          ? '✅ このチャンネルの Codex モデル固定を解除しました'
          : 'ℹ️ このチャンネルの Codex モデルは未設定です'
      };
    }

    return {
      text: '❌ 無効なサブコマンドです。\n使用方法: `/codex-model status` `/codex-model use <model>` `/codex-model clear`'
    };
  }

  private async handleUpdateCommand(message: BotMessage): Promise<BotResponse | null> {
    const action = message.text?.trim().toLowerCase() || 'pull';
    if (action === 'status') {
      return this.buildApplicationUpdateResponse('アプリ更新ステータス', await this.applicationUpdateService.getUpdateStatus());
    }

    if (action === 'pull' || action === 'update' || action === 'latest') {
      return this.buildApplicationUpdateResponse('アプリ更新', await this.applicationUpdateService.updateApplication(action));
    }

    if (action === 'restart') {
      return this.handleRestartCommand();
    }

    return {
      text: '❌ 無効なサブコマンドです。\n使用方法: `/agent-update` `/agent-update status` `/agent-update restart`'
    };
  }

  private async handleRestartCommand(): Promise<BotResponse | null> {
    const result = this.applicationUpdateService.restartApplication();
    return this.buildRestartResponse(result);
  }

  private buildApplicationUpdateResponse(title: string, result: ApplicationUpdateResult): BotResponse {
    const status = result.success ? '✅' : '❌';
    const detailText = result.details?.length ? `\n\n${result.details.map(detail => `• ${detail}`).join('\n')}` : '';
    const text = `${status} ${result.summary}${detailText}`;
    return {
      text,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${title}*\n\n${text}`
          }
        }
      ]
    };
  }

  private buildRestartResponse(result: RestartResult): BotResponse {
    const text = result.success
      ? '✅ アプリケーションの再起動を予約しました。数秒後に現在のプロセスを停止します。'
      : `❌ アプリケーションの再起動予約に失敗しました: ${result.error || '不明なエラー'}`;
    return {
      text,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text
          }
        }
      ]
    };
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
