import { BotAdapter, BotMessage, BotResponse } from './interfaces/BotInterface';
import { SlackAdapter } from './adapters/SlackAdapter';
import { DiscordAdapter } from './adapters/DiscordAdapter';
import { ClaudeCLIClient } from './claudeCLIClient';
import { StorageService } from './services/StorageService';
import { GitService } from './services/GitService';
import { createLogger } from './utils/logger';

const logger = createLogger('BotManager');

export class BotManager {
  private bots: BotAdapter[] = [];
  private claudeClient: ClaudeCLIClient;
  private storageService: StorageService;
  private gitService: GitService;

  constructor() {
    this.claudeClient = new ClaudeCLIClient();
    this.storageService = new StorageService();
    this.gitService = new GitService();
  }

  addSlackBot(token: string, signingSecret: string, appToken: string): void {
    const slackBot = new SlackAdapter(token, signingSecret, appToken);
    this.setupBot(slackBot);
    this.bots.push(slackBot);
  }

  addDiscordBot(token: string): void {
    const discordBot = new DiscordAdapter(token);
    this.setupBot(discordBot);
    this.bots.push(discordBot);
  }

  private setupBot(bot: BotAdapter): void {
    // Setup message handler for mentions and DMs
    bot.onMessage(async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '👋 Hi! How can I help you? Just send me your question.',
        };
      }

      // Check if channel has a repository configured
      const repo = this.storageService.getChannelRepository(message.channelId);
      const workingDirectory = repo?.localPath;

      // バックグラウンド完了時のコールバック
      const onBackgroundComplete = async (bgResult: any) => {
        await bot.sendMessage(message.channelId, {
          text: '✅ バックグラウンド処理が完了しました',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: bgResult.error 
                  ? `❌ バックグラウンド処理でエラーが発生しました:\n${bgResult.error}`
                  : `✅ バックグラウンド処理が完了しました:\n${bgResult.response}`,
              },
            },
          ],
        });
      };

      const result = await this.claudeClient.sendPrompt(message.text, {
        workingDirectory,
        onBackgroundComplete
      });

      if (result.error) {
        return {
          text: `❌ Error: ${result.error}`,
        };
      }

      return {
        text: result.response,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: result.response,
            },
          },
        ],
      };
    });

    // Setup /claude command handler
    bot.onCommand('claude', async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '📝 Please provide a prompt. Usage: `/claude <your prompt>`',
        };
      }

      // Check if channel has a repository configured
      const repo = this.storageService.getChannelRepository(message.channelId);
      const workingDirectory = repo?.localPath;

      // バックグラウンド完了時のコールバック
      const onBackgroundComplete = async (bgResult: any) => {
        await bot.sendMessage(message.channelId, {
          text: '✅ バックグラウンド処理が完了しました',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: bgResult.error 
                  ? `❌ バックグラウンド処理でエラーが発生しました:\n${bgResult.error}`
                  : `✅ バックグラウンド処理が完了しました:\n${bgResult.response}`,
              },
            },
          ],
        });
      };

      const result = await this.claudeClient.sendPrompt(message.text, {
        workingDirectory,
        onBackgroundComplete
      });

      if (result.error) {
        return {
          text: `❌ Error: ${result.error}`,
        };
      }

      return {
        text: result.response,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Claude says:*\n${result.response}`,
            },
          },
        ],
      };
    });

    // Setup /claude-help command handler
    bot.onCommand('claude-help', async (message: BotMessage): Promise<BotResponse | null> => {
      return {
        text: 'Claude Bot ヘルプ',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*利用可能なコマンド:*\n\n' +
                    '• `/claude <プロンプト>` - Claudeに質問やタスクを送信\n' +
                    '• `/claude-repo <URL>` - Gitリポジトリをクローンしてチャンネルにリンク\n' +
                    '• `/claude-repo status` - 現在のリポジトリ状態を確認\n' +
                    '• `/claude-repo delete` - このチャンネルのリポジトリリンクを削除\n' +
                    '• `/claude-repo reset` - すべてのリポジトリリンクをリセット\n' +
                    '• `/claude-status` - Claude CLIの状態を確認\n' +
                    '• `/claude-clear` - 会話のコンテキストをクリア\n' +
                    '• `/claude-help` - このヘルプを表示\n\n' +
                    '*その他の使い方:*\n' +
                    '• ボットに直接メッセージを送信\n' +
                    '• チャンネルでボットをメンション (@ボット名)\n\n' +
                    '*リポジトリ連携:*\n' +
                    'リポジトリをリンクすると、Claudeはそのリポジトリのコードコンテキストで応答します。',
            },
          },
        ],
      };
    });

    // Setup /claude-status command handler
    bot.onCommand('claude-status', async (message: BotMessage): Promise<BotResponse | null> => {
      const isAvailable = await this.claudeClient.checkAvailability();
      const repo = this.storageService.getChannelRepository(message.channelId);
      
      let statusText = `*Claude CLI:* ${isAvailable ? '✅ 利用可能' : '❌ 利用不可'}\n`;
      statusText += `*チャンネルID:* ${message.channelId}\n`;
      
      if (repo) {
        statusText += `*リンクされたリポジトリ:* ${repo.repositoryUrl}\n`;
        statusText += `*リポジトリパス:* ${repo.localPath}`;
      } else {
        statusText += `*リンクされたリポジトリ:* なし`;
      }
      
      return {
        text: 'システムステータス',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: statusText,
            },
          },
        ],
      };
    });

    // Setup /claude-clear command handler
    bot.onCommand('claude-clear', async (message: BotMessage): Promise<BotResponse | null> => {
      // 注: 現在の実装ではClaude CLIは状態を保持していないため、
      // このコマンドは将来の拡張用のプレースホルダーです
      return {
        text: '🧹 会話コンテキストをクリアしました',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '✅ 新しい会話を開始できます。\n\n' +
                    '_注: 現在の実装では各メッセージは独立して処理されます。_',
            },
          },
        ],
      };
    });

    // Setup /claude-repo command handler
    bot.onCommand('claude-repo', async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '📝 使い方: `/claude-repo <リポジトリURL>` でクローン、`/claude-repo status` で状態確認',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*リポジトリ管理コマンド*\n\n' +
                      '• `/claude-repo <リポジトリURL>` - リポジトリをクローンしてチャンネルに紐付け\n' +
                      '• `/claude-repo status` - 現在のリポジトリ状態を確認\n' +
                      '• `/claude-repo delete` - チャンネルとリポジトリの紐付けを削除',
              },
            },
          ],
        };
      }

      const args = message.text.trim().toLowerCase();

      // Handle status command
      if (args === 'status') {
        const repo = this.storageService.getChannelRepository(message.channelId);
        if (!repo) {
          return {
            text: '❌ このチャンネルにはリポジトリが設定されていません',
          };
        }

        const status = await this.gitService.getRepositoryStatus(repo.localPath);
        if (!status.success) {
          return {
            text: `❌ リポジトリの状態を取得できませんでした: ${status.error}`,
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
                      `クローン日時: ${new Date(repo.createdAt).toLocaleString('ja-JP')}\n\n` +
                      `*Git状態*\n\`\`\`${status.status}\`\`\``,
              },
            },
          ],
        };
      }

      // Handle delete command
      if (args === 'delete') {
        const deleted = this.storageService.deleteChannelRepository(message.channelId);
        if (deleted) {
          return {
            text: '✅ チャンネルとリポジトリの紐付けを削除しました',
          };
        } else {
          return {
            text: '❌ このチャンネルにはリポジトリが設定されていません',
          };
        }
      }

      // Handle reset command - すべてのリポジトリ関係をリセット
      if (args === 'reset') {
        const channels = this.storageService.getAllChannelRepositories();
        const channelCount = Object.keys(channels).length;
        
        if (channelCount === 0) {
          return {
            text: '❌ 現在リポジトリが紐付けられているチャンネルはありません',
          };
        }

        // すべてのチャンネルのリポジトリ紐付けを削除
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
                      `すべてのチャンネルのリポジトリ紐付けが削除されました。`,
              },
            },
          ],
        };
      }

      // Handle clone command (repository URL)
      const repoUrl = message.text.trim();
      
      // Basic URL validation
      if (!repoUrl.match(/^(https?:\/\/|git@)/)) {
        return {
          text: '❌ 有効なリポジトリURLを入力してください（HTTPSまたはSSH形式）',
        };
      }

      // Clone the repository
      const cloneResult = await this.gitService.cloneRepository(repoUrl, message.channelId);
      
      if (!cloneResult.success) {
        return {
          text: `❌ リポジトリのクローンに失敗しました: ${cloneResult.error}`,
        };
      }

      // Save the channel-repository mapping
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
                    `これでこのチャンネルでClaudeに話しかけると、このリポジトリのコンテキストで応答します。`,
            },
          },
        ],
      };
    });
  }

  async startAll(): Promise<void> {
    logger.info('Starting all bots');
    
    const isAvailable = await this.claudeClient.checkAvailability();
    logger.info('Claude CLI availability check', { available: isAvailable });
    
    if (!isAvailable) {
      logger.warn('Claude CLI not found. Please install from: https://claude.ai/download');
    }
    
    await Promise.all(this.bots.map(bot => bot.start()));
    logger.info('All bots started', { count: this.bots.length });
  }

  async stopAll(): Promise<void> {
    logger.info('Stopping all bots');
    await Promise.all(this.bots.map(bot => bot.stop()));
    logger.info('All bots stopped', { count: this.bots.length });
    
    // クリーンアップ実行
    this.claudeClient.cleanup();
    logger.debug('Claude client cleanup completed');
  }
}