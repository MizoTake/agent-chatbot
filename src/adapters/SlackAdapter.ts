import { App } from '@slack/bolt';
import { BotAdapter, BotMessage, BotResponse } from '../interfaces/BotInterface';

export class SlackAdapter implements BotAdapter {
  private app: App;
  private messageHandler?: (message: BotMessage) => Promise<BotResponse | null>;
  private commandHandlers: Map<string, (message: BotMessage) => Promise<BotResponse | null>> = new Map();

  constructor(token: string, signingSecret: string, appToken: string) {
    this.app = new App({
      token,
      signingSecret,
      socketMode: true,
      appToken,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle slash commands
    this.app.command('/claude', async ({ command, ack, respond }) => {
      await ack();
      
      const botMessage: BotMessage = {
        text: command.text || '',
        channelId: command.channel_id,
        userId: command.user_id,
        isDirectMessage: command.channel_name === 'directmessage',
        isMention: false,
        isCommand: true,
        commandName: 'claude',
      };

      const handler = this.commandHandlers.get('claude');
      if (handler) {
        await respond({ text: '🤔 Thinking...' });
        const response = await handler(botMessage);
        if (response) {
          await respond({
            text: response.text,
            blocks: response.blocks,
          });
        }
      }
    });

    this.app.command('/claude-code', async ({ command, ack, respond }) => {
      await ack();
      
      const botMessage: BotMessage = {
        text: command.text || '',
        channelId: command.channel_id,
        userId: command.user_id,
        isDirectMessage: command.channel_name === 'directmessage',
        isMention: false,
        isCommand: true,
        commandName: 'claude-code',
      };

      const handler = this.commandHandlers.get('claude-code');
      if (handler) {
        await respond({ text: '💻 Working on your code...' });
        const response = await handler(botMessage);
        if (response) {
          await respond({
            text: response.text,
            blocks: response.blocks,
          });
        }
      }
    });

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

    // Handle direct messages
    this.app.message(async ({ message, client }) => {
      if (message.subtype) return;
      
      const directMessage = message.channel_type === 'im';
      
      if (directMessage && message.text) {
        const botMessage: BotMessage = {
          text: message.text,
          channelId: message.channel,
          userId: message.user || '',
          isDirectMessage: true,
          isMention: false,
          isCommand: false,
        };

        if (this.messageHandler) {
          const response = await this.messageHandler(botMessage);
          if (response) {
            await client.chat.postMessage({
              channel: message.channel,
              text: response.text,
              blocks: response.blocks,
            });
          }
        }
      }
    });
  }

  async start(): Promise<void> {
    await this.app.start();
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
}