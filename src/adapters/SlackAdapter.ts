import { App } from '@slack/bolt';
import { BotAdapter, BotMessage, BotResponse } from '../interfaces/BotInterface';

export class SlackAdapter implements BotAdapter {
  private app: App;
  private messageHandler?: (message: BotMessage) => Promise<BotResponse | null>;
  private commandHandlers: Map<string, (message: BotMessage) => Promise<BotResponse | null>> = new Map();
  private agentName: string;

  constructor(token: string, signingSecret: string, appToken: string, agentName: string = 'agent') {
    this.app = new App({
      token,
      signingSecret,
      socketMode: true,
      appToken,
    });
    this.agentName = agentName;

    this.setupEventHandlers();
  }

  setAgentName(agentName: string): void {
    this.agentName = agentName;
  }

  private setupEventHandlers(): void {
    const registerSlashCommand = (
      slashCommand: string,
      commandName: string,
      initialResponseText?: string
    ): void => {
      this.app.command(slashCommand, async ({ command, ack, respond }) => {
        await ack();

        const botMessage: BotMessage = {
          text: command.text || '',
          channelId: command.channel_id,
          userId: command.user_id,
          isDirectMessage: command.channel_name === 'directmessage',
          isMention: false,
          isCommand: true,
          commandName,
        };

        const handler = this.commandHandlers.get(commandName);
        if (!handler) {
          return;
        }

        if (initialResponseText) {
          await respond({ text: initialResponseText });
        }

        const response = await handler(botMessage);
        if (response) {
          await respond({
            text: response.text,
            blocks: response.blocks,
          });
        }
      });
    };

    registerSlashCommand('/agent', 'agent', '🤔 Thinking...');
    registerSlashCommand('/claude', 'claude', '🤔 Thinking...');
    registerSlashCommand('/agent-help', 'agent-help');
    registerSlashCommand('/claude-help', 'claude-help');
    registerSlashCommand('/agent-status', 'agent-status');
    registerSlashCommand('/claude-status', 'claude-status');
    registerSlashCommand('/agent-clear', 'agent-clear');
    registerSlashCommand('/claude-clear', 'claude-clear');
    registerSlashCommand('/agent-repo', 'agent-repo', '🔄 Processing repository command...');
    registerSlashCommand('/claude-repo', 'claude-repo', '🔄 Processing repository command...');
    registerSlashCommand('/agent-skip-permissions', 'agent-skip-permissions');
    registerSlashCommand('/claude-skip-permissions', 'claude-skip-permissions');
    registerSlashCommand('/agent-tool', 'agent-tool');
    registerSlashCommand('/claude-tool', 'claude-tool');
    registerSlashCommand('/takt-run', 'takt-run', '🎵 TAKT executing...');
    registerSlashCommand('/orcha-run', 'orcha-run', '🎼 orcha executing...');

    // Handle app mentions
    this.app.event('app_mention', async ({ event, client }) => {
      const mentionText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
      
      const botMessage: BotMessage = {
        text: mentionText,
        channelId: event.channel,
        userId: event.user || '',
        isDirectMessage: false,
        isMention: true,
        isCommand: false,
      };

      if (this.messageHandler) {
        await client.chat.postMessage({
          channel: event.channel,
          text: '🤔 Let me think about that...',
        });

        const response = await this.messageHandler(botMessage);
        if (response) {
          await client.chat.postMessage({
            channel: event.channel,
            text: response.text,
            blocks: response.blocks,
          });
        }
      }
    });

    // Handle direct messages and channel messages
    this.app.message(async ({ message, client }) => {
      if (message.subtype) return;
      
      const directMessage = message.channel_type === 'im';
      const channelMessage = message.channel_type === 'channel' || message.channel_type === 'group';
      
      // Handle both DMs and channel messages
      if ((directMessage || channelMessage) && message.text) {
        const botMessage: BotMessage = {
          text: message.text,
          channelId: message.channel,
          userId: message.user || '',
          isDirectMessage: directMessage,
          isMention: false,
          isCommand: false,
        };

        if (this.messageHandler) {
          // チャンネルメッセージの場合は考え中メッセージを送信
          if (channelMessage) {
            await client.chat.postMessage({
              channel: message.channel,
              text: '🤔 考えています...',
              thread_ts: message.ts, // スレッドに返信
            });
          }

          const response = await this.messageHandler(botMessage);
          if (response) {
            await client.chat.postMessage({
              channel: message.channel,
              text: response.text,
              blocks: response.blocks,
              thread_ts: channelMessage ? message.ts : undefined, // チャンネルメッセージはスレッドに返信
            });
          }
        }
      }
    });
  }

  async start(): Promise<void> {
    await this.app.start();
    await this.syncIdentity();
    console.log('⚡️ Slack bot is running!');
  }

  async stop(): Promise<void> {
    await this.app.stop();
    console.log('🛑 Slack bot stopped');
  }

  async sendMessage(channelId: string, response: BotResponse): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: channelId,
      text: response.text,
      blocks: response.blocks,
    });
  }

  async sendThinkingMessage(channelId: string): Promise<void> {
    await this.sendMessage(channelId, { text: '🤔 Thinking...' });
  }

  onMessage(handler: (message: BotMessage) => Promise<BotResponse | null>): void {
    this.messageHandler = handler;
  }

  onCommand(command: string, handler: (message: BotMessage) => Promise<BotResponse | null>): void {
    this.commandHandlers.set(command, handler);
  }

  private async syncIdentity(): Promise<void> {
    const normalizedAgentName = this.agentName.trim();
    if (!normalizedAgentName) {
      return;
    }

    try {
      const authResult = await this.app.client.auth.test();
      if (!authResult.user_id) {
        return;
      }

      await this.app.client.users.profile.set({
        user: authResult.user_id,
        profile: JSON.stringify({
          display_name: normalizedAgentName,
          real_name: normalizedAgentName,
        }),
      } as any);

      console.log(`✅ Slack bot display name updated to ${normalizedAgentName}`);
    } catch (error: any) {
      const slackError = error?.data?.error || error?.message || String(error);
      console.warn(`⚠️ Failed to update Slack bot display name to ${normalizedAgentName}: ${slackError}`);
    }
  }
}
