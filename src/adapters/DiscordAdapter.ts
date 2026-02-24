import { Client, GatewayIntentBits, Message, Interaction, TextChannel, DMChannel, Partials } from 'discord.js';
import { BotAdapter, BotMessage, BotResponse } from '../interfaces/BotInterface';

const DISCORD_CONTENT_MAX_LENGTH = 2000;
const DISCORD_EMBED_DESCRIPTION_MAX_LENGTH = 4096;
const DISCORD_EMBEDS_MAX_COUNT = 10;

export class DiscordAdapter implements BotAdapter {
  private client: Client;
  private messageHandler?: (message: BotMessage) => Promise<BotResponse | null>;
  private commandHandlers: Map<string, (message: BotMessage) => Promise<BotResponse | null>> = new Map();
  private botUserId?: string;
  private agentName: string;
  private readonly token: string;
  private isLoggedIn: boolean = false;

  constructor(token: string, agentName: string = 'agent') {
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
      partials: [Partials.Message, Partials.Channel], // Required for DM handling
    });
    this.agentName = agentName;
    this.token = token;

    this.setupEventHandlers();
  }

  setAgentName(agentName: string): void {
    this.agentName = agentName;
  }

  private setupEventHandlers(): void {
    this.client.once('ready', () => {
      console.log(`Discord bot logged in as ${this.client.user?.tag}`);
      this.botUserId = this.client.user?.id;
      void this.syncIdentity();
      void this.registerSlashCommands();
    });

    this.client.on('messageCreate', async (message: Message) => {
      try {
        if (message.author.bot) return;

        const isMention = message.mentions.has(this.client.user!);
        const isDirectMessage = message.channel.type === 1;
        const isGuildChannel = message.channel.type === 0;

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
            if (isGuildChannel && !isMention) {
              const thinkingMsg = await message.reply({
                content: 'Thinking...',
                allowedMentions: {
                  repliedUser: false,
                },
              });

              const response = await this.messageHandler(botMessage);
              if (response) {
                await message.reply({
                  ...this.buildMessagePayload(response),
                  allowedMentions: {
                    repliedUser: true,
                  },
                });
                await thinkingMsg.delete().catch(() => {
                  // Ignore delete errors
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
      } catch (error) {
        this.logDiscordApiError('messageCreate', error);
      }
    });

    this.client.on('interactionCreate', async (interaction: Interaction) => {
      try {
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
            await interaction.editReply(this.buildMessagePayload(response));
          }
        }
      } catch (error) {
        this.logDiscordApiError('interactionCreate', error);
      }
    });
  }

  private async syncIdentity(): Promise<void> {
    const normalizedAgentName = this.agentName.trim();
    if (!normalizedAgentName || !this.client.user) {
      return;
    }

    try {
      if (this.client.user.username !== normalizedAgentName) {
        await this.client.user.setUsername(normalizedAgentName);
        console.log(`Discord bot username updated to ${normalizedAgentName}`);
      }
    } catch (error) {
      console.warn(`Failed to update Discord bot username to ${normalizedAgentName}:`, error);
    }

    try {
      this.client.user.setActivity(`${normalizedAgentName} ready`);
    } catch (error) {
      console.warn('Failed to update Discord bot presence:', error);
    }
  }

  private cleanMessageContent(content: string): string {
    return content.replace(/<@!?\d+>/g, '').trim();
  }

  private truncateText(text: string | undefined, maxLength: number): string | undefined {
    if (!text) {
      return undefined;
    }
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength);
  }

  private convertBlocksToEmbeds(blocks: any[]): any[] {
    const embeds: any[] = [];

    blocks.forEach(block => {
      if (embeds.length >= DISCORD_EMBEDS_MAX_COUNT) {
        return;
      }

      if (block?.type !== 'section' || !block?.text) {
        return;
      }

      const description = this.truncateText(
        typeof block.text.text === 'string' ? block.text.text : '',
        DISCORD_EMBED_DESCRIPTION_MAX_LENGTH
      );

      if (!description) {
        return;
      }

      embeds.push({
        description,
        color: 0x5865F2,
      });
    });

    return embeds;
  }

  private buildMessagePayload(response: BotResponse): { content: string; embeds?: any[] } | { content?: undefined; embeds: any[] } {
    const embeds = response.blocks ? this.convertBlocksToEmbeds(response.blocks) : undefined;
    if (embeds && embeds.length > 0) {
      return { embeds };
    }

    const content = this.truncateText(response.text, DISCORD_CONTENT_MAX_LENGTH) || ' ';
    return { content };
  }

  private logDiscordApiError(context: string, error: unknown): void {
    const apiError = error as { rawError?: { errors?: unknown } };
    if (apiError?.rawError?.errors) {
      console.error(
        `Discord API validation errors (${context}):`,
        JSON.stringify(apiError.rawError.errors, null, 2)
      );
    }
    console.error(`Discord handler error (${context}):`, error);
  }

  private async registerSlashCommands(): Promise<void> {
    const normalizedAgentName = this.agentName.trim() || 'agent';

    const commands = [
      {
        name: 'agent',
        description: `Chat with ${normalizedAgentName}`,
        options: [{
          name: 'prompt',
          type: 3,
          description: `Your message to ${normalizedAgentName}`,
          required: true,
        }],
      },
      {
        name: 'claude',
        description: `Chat with ${normalizedAgentName} (legacy alias)`,
        options: [{
          name: 'prompt',
          type: 3,
          description: `Your message to ${normalizedAgentName}`,
          required: true,
        }],
      },
      {
        name: 'agent-help',
        description: `Show ${normalizedAgentName} help`,
      },
      {
        name: 'claude-help',
        description: `Show ${normalizedAgentName} help (legacy alias)`,
      },
      {
        name: 'agent-status',
        description: 'Show tool and repository status',
      },
      {
        name: 'claude-status',
        description: 'Show tool and repository status (legacy alias)',
      },
      {
        name: 'agent-clear',
        description: 'Clear conversation context',
      },
      {
        name: 'claude-clear',
        description: 'Clear conversation context (legacy alias)',
      },
      {
        name: 'agent-repo',
        description: 'Manage repository for this channel',
        options: [{
          name: 'prompt',
          type: 3,
          description: '<url> / status / tool <name> / delete / reset',
          required: true,
        }],
      },
      {
        name: 'claude-repo',
        description: 'Manage repository for this channel (legacy alias)',
        options: [{
          name: 'prompt',
          type: 3,
          description: '<url> / status / tool <name> / delete / reset',
          required: true,
        }],
      },
      {
        name: 'agent-skip-permissions',
        description: 'Toggle --dangerously-skip-permissions flag',
        options: [{
          name: 'prompt',
          type: 3,
          description: 'on|enable / off|disable / empty to toggle',
          required: false,
        }],
      },
      {
        name: 'claude-skip-permissions',
        description: 'Toggle --dangerously-skip-permissions flag (legacy alias)',
        options: [{
          name: 'prompt',
          type: 3,
          description: 'on|enable / off|disable / empty to toggle',
          required: false,
        }],
      },
      {
        name: 'agent-tool',
        description: 'Tool command: list/status/use/clear',
        options: [{
          name: 'prompt',
          type: 3,
          description: 'list / status / use <name> / clear',
          required: false,
        }],
      },
      {
        name: 'claude-tool',
        description: 'Tool command: list/status/use/clear (legacy alias)',
        options: [{
          name: 'prompt',
          type: 3,
          description: 'list / status / use <name> / clear',
          required: false,
        }],
      },
    ];

    try {
      await this.client.application?.commands.set(commands);
      console.log('Discord slash commands registered');
    } catch (error) {
      this.logDiscordApiError('registerSlashCommands', error);
    }
  }

  async start(): Promise<void> {
    if (this.isLoggedIn) {
      console.log('Discord bot is already running');
      return;
    }

    await this.client.login(this.token);
    this.isLoggedIn = true;
    console.log('Discord bot starting...');
  }

  async stop(): Promise<void> {
    await this.client.destroy();
    this.isLoggedIn = false;
    console.log('Discord bot stopped');
  }

  async sendMessage(channelId: string, response: BotResponse): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel && (channel instanceof TextChannel || channel instanceof DMChannel)) {
        await channel.send(this.buildMessagePayload(response));
      }
    } catch (error) {
      this.logDiscordApiError('sendMessage', error);
    }
  }

  async sendThinkingMessage(channelId: string): Promise<void> {
    await this.sendMessage(channelId, { text: 'Thinking...' });
  }

  onMessage(handler: (message: BotMessage) => Promise<BotResponse | null>): void {
    this.messageHandler = handler;
  }

  onCommand(command: string, handler: (message: BotMessage) => Promise<BotResponse | null>): void {
    this.commandHandlers.set(command, handler);
  }
}
