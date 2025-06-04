import { Client, GatewayIntentBits, Message, Interaction, TextChannel, DMChannel, Partials } from 'discord.js';
import { BotAdapter, BotMessage, BotResponse } from '../interfaces/BotInterface';

export class DiscordAdapter implements BotAdapter {
  private client: Client;
  private messageHandler?: (message: BotMessage) => Promise<BotResponse | null>;
  private commandHandlers: Map<string, (message: BotMessage) => Promise<BotResponse | null>> = new Map();
  private botUserId?: string;

  constructor(token: string) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
      ],
      partials: [Partials.Message, Partials.Channel], // DMを受信するために必要
    });

    this.setupEventHandlers();
    this.client.login(token);
  }

  private setupEventHandlers(): void {
    this.client.once('ready', () => {
      console.log(`🤖 Discord bot logged in as ${this.client.user?.tag}`);
      this.botUserId = this.client.user?.id;
      this.registerSlashCommands();
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;

      const isMention = message.mentions.has(this.client.user!);
      const isDirectMessage = message.channel.type === 1; // DM channel type
      const isGuildChannel = message.channel.type === 0; // Guild text channel

      // Handle DMs, mentions, and all guild channel messages
      if (isDirectMessage || isMention || isGuildChannel) {
        const botMessage: BotMessage = {
          text: this.cleanMessageContent(message.content),
          channelId: message.channelId,
          userId: message.author.id,
          isDirectMessage,
          isMention,
          isCommand: false,
        };

        if (this.messageHandler) {
          // Send thinking message for guild channels
          if (isGuildChannel && !isMention) {
            const thinkingMsg = await message.reply('🤔 考えています...');
            
            const response = await this.messageHandler(botMessage);
            if (response) {
              const embeds = response.blocks ? this.convertBlocksToEmbeds(response.blocks) : undefined;
              await thinkingMsg.edit({
                content: embeds && embeds.length > 0 ? undefined : response.text,
                embeds: embeds,
              });
            }
          } else {
            const response = await this.messageHandler(botMessage);
            if (response) {
              await this.sendMessage(message.channelId, response);
            }
          }
        }
      }
    });

    this.client.on('interactionCreate', async (interaction: Interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const botMessage: BotMessage = {
        text: interaction.options.getString('prompt') || '',
        channelId: interaction.channelId!,
        userId: interaction.user.id,
        isDirectMessage: !interaction.guild,
        isMention: false,
        isCommand: true,
        commandName: interaction.commandName,
      };

      const handler = this.commandHandlers.get(interaction.commandName);
      if (handler) {
        await interaction.deferReply();
        const response = await handler(botMessage);
        if (response) {
          const embeds = response.blocks ? this.convertBlocksToEmbeds(response.blocks) : undefined;
          await interaction.editReply({
            content: embeds && embeds.length > 0 ? undefined : response.text,
            embeds: embeds,
          });
        }
      }
    });
  }

  private cleanMessageContent(content: string): string {
    // Remove bot mentions
    return content.replace(/<@!?\d+>/g, '').trim();
  }

  private convertBlocksToEmbeds(blocks: any[]): any[] {
    // Convert Slack-style blocks to Discord embeds
    const embeds: any[] = [];
    
    blocks.forEach(block => {
      if (block.type === 'section' && block.text) {
        embeds.push({
          description: block.text.text,
          color: 0x5865F2,
        });
      }
    });
    
    return embeds;
  }

  private async registerSlashCommands(): Promise<void> {
    const commands = [
      {
        name: 'claude',
        description: 'Chat with Claude',
        options: [{
          name: 'prompt',
          type: 3, // STRING type
          description: 'Your message to Claude',
          required: true,
        }],
      },
      {
        name: 'claude-code',
        description: 'Get coding help from Claude',
        options: [{
          name: 'prompt',
          type: 3, // STRING type
          description: 'Your coding question or task',
          required: true,
        }],
      },
      {
        name: 'claude-repo',
        description: 'Manage repository for this channel',
        options: [{
          name: 'prompt',
          type: 3, // STRING type
          description: 'Repository URL to clone or "status" to check current repo',
          required: true,
        }],
      },
    ];

    try {
      await this.client.application?.commands.set(commands);
      console.log('✅ Discord slash commands registered');
    } catch (error) {
      console.error('Failed to register slash commands:', error);
    }
  }

  async start(): Promise<void> {
    // Client is already starting in constructor
    console.log('🚀 Discord bot starting...');
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    console.log('🛑 Discord bot stopped');
  }

  async sendMessage(channelId: string, response: BotResponse): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel)) {
        const embeds = response.blocks ? this.convertBlocksToEmbeds(response.blocks) : undefined;
        await channel.send({
          content: embeds && embeds.length > 0 ? undefined : response.text,
          embeds,
        });
      }
    } catch (error) {
      console.error('Failed to send Discord message:', error);
    }
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