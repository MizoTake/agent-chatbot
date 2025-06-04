import { BotAdapter, BotMessage, BotResponse } from './interfaces/BotInterface';
import { SlackAdapter } from './adapters/SlackAdapter';
import { DiscordAdapter } from './adapters/DiscordAdapter';
import { ClaudeCLIClient } from './claudeCLIClient';

export class BotManager {
  private bots: BotAdapter[] = [];
  private claudeClient: ClaudeCLIClient;

  constructor() {
    this.claudeClient = new ClaudeCLIClient();
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

      const result = await this.claudeClient.sendPrompt(message.text);

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

      const result = await this.claudeClient.sendPrompt(message.text);

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

    // Setup /claude-code command handler
    bot.onCommand('claude-code', async (message: BotMessage): Promise<BotResponse | null> => {
      if (!message.text) {
        return {
          text: '📝 Please provide a code-related prompt. Usage: `/claude-code <your coding task>`',
        };
      }

      // Add code context to the prompt
      const codePrompt = `Please provide a code solution or explanation for: ${message.text}`;
      const result = await this.claudeClient.sendPrompt(codePrompt);

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
              text: `*Code Response:*\n${result.response}`,
            },
          },
        ],
      };
    });
  }

  async startAll(): Promise<void> {
    console.log('🚀 Starting all bots...');
    
    const isAvailable = await this.claudeClient.checkAvailability();
    console.log(`🤖 Claude CLI status: ${isAvailable ? '✅ Available' : '❌ Not found'}`);
    
    if (!isAvailable) {
      console.log('⚠️  Claude CLIが見つかりません。インストールしてください: https://claude.ai/download');
    }
    
    await Promise.all(this.bots.map(bot => bot.start()));
    console.log(`✅ Started ${this.bots.length} bot(s)`);
  }

  async stopAll(): Promise<void> {
    console.log('🛑 Stopping all bots...');
    await Promise.all(this.bots.map(bot => bot.stop()));
    console.log(`✅ Stopped ${this.bots.length} bot(s)`);
  }
}