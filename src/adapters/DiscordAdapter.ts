import * as fs from 'fs';
import * as path from 'path';

import { AttachmentBuilder, Client, GatewayIntentBits, Message, Interaction, TextChannel, DMChannel, Partials } from 'discord.js';
import { BotAdapter, BotMessage, BotResponse } from '../interfaces/BotInterface';
import { createLogger } from '../utils/logger';

const logger = createLogger('DiscordAdapter');

const DISCORD_CONTENT_MAX_LENGTH = 2000;
const DISCORD_EMBED_DESCRIPTION_MAX_LENGTH = 4096;
const DISCORD_EMBEDS_MAX_COUNT = 10;
const DISCORD_ATTACHMENTS_MAX_COUNT = 10;
const DISCORD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DISCORD_CODE_BLOCK_PATTERN = /(```[\s\S]*?```)/g;

interface DiscordImageAttachment {
  path: string;
  fileName: string;
}

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

  private canSendDiscordRequest(): boolean {
    // this.client.token is managed by discord.js and can be set to null
    // internally (e.g. during Client.destroy()) even while our isLoggedIn flag
    // remains true (race condition: a messageCreate already queued before the
    // WebSocket closed). Use our own readonly token copy instead.
    return this.isLoggedIn && Boolean(this.token?.trim());
  }

  private ensureRestTokenConfigured(context: string): boolean {
    const normalizedToken = this.token?.trim();
    if (!this.isLoggedIn || !normalizedToken) {
      logger.warn(`Skip Discord request: token is not ready`, {
        context,
        isLoggedIn: this.isLoggedIn,
        hasToken: Boolean(this.client.token),
      });
      return false;
    }

    this.client.rest.setToken(normalizedToken);
    return true;
  }

  private setupEventHandlers(): void {
    // Use 'on' (not 'once') so reconnections after session expiry also update
    // botUserId and re-register slash commands.
    this.client.on('ready', () => {
      logger.info('Discord bot logged in', { tag: this.client.user?.tag });
      this.botUserId = this.client.user?.id;
      void this.syncIdentity();
      void this.registerSlashCommands();
    });

    this.client.on('shardDisconnect', (event, shardId) => {
      // Close codes that discord.js will NOT auto-recover from
      const NON_RECOVERABLE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
      if (NON_RECOVERABLE_CODES.has(event.code)) {
        logger.error('Discord shard disconnected with non-recoverable code — bot requires restart', undefined, { shardId, code: event.code });
        this.isLoggedIn = false;
      } else {
        logger.warn('Discord shard disconnected, waiting for auto-reconnect', { shardId, code: event.code });
      }
    });

    this.client.on('messageCreate', async (message: Message) => {
      try {
        if (message.author.bot) return;

        const isMention = message.mentions.has(this.client.user!);
        const isDirectMessage = message.channel.type === 1;
        const isGuildChannel = message.channel.type === 0;

        if (isDirectMessage || isMention || isGuildChannel) {
          const cleanedText = this.cleanMessageContent(message.content);

          // Route /command messages to registered command handlers
          const slashMatch = cleanedText.match(/^\/([a-zA-Z][\w-]*)\s*([\s\S]*)$/);
          if (slashMatch) {
            const commandName = slashMatch[1];
            const commandHandler = this.commandHandlers.get(commandName);
            if (commandHandler) {
              const cmdMessage: BotMessage = {
                text: slashMatch[2].trim() || '',
                channelId: message.channelId,
                userId: message.author.id,
                isDirectMessage,
                isMention,
                isCommand: true,
                commandName,
              };

              if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('messageCreate:command')) {
                return;
              }

              const sendTyping = () => {
                if ('sendTyping' in message.channel && typeof message.channel.sendTyping === 'function') {
                  (message.channel.sendTyping() as Promise<void>).catch(() => {});
                }
              };
              const typingInterval = setInterval(sendTyping, 8000);
              sendTyping();

              let response: BotResponse | null;
              try {
                response = await commandHandler(cmdMessage);
              } finally {
                clearInterval(typingInterval);
              }

              if (response) {
                if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('messageCreate:command:reply')) {
                  return;
                }
                await this.sendSplitReply(message, response);
              }
              return;
            }
          }

          const botMessage: BotMessage = {
            text: cleanedText,
            channelId: message.channelId,
            userId: message.author.id,
            isDirectMessage,
            isMention,
            isCommand: false,
          };

          if (this.messageHandler) {
            if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('messageCreate:thinking')) {
              logger.warn('Skip Discord reply in messageCreate: token is not ready', {
                isLoggedIn: this.isLoggedIn,
                hasToken: Boolean(this.client.token),
                channelId: message.channelId,
              });
              return;
            }

            // Show typing indicator while processing (refreshes every 8s)
            const channel = message.channel;
            const sendTyping = () => {
              if ('sendTyping' in channel && typeof channel.sendTyping === 'function') {
                (channel.sendTyping() as Promise<void>).catch(() => {});
              }
            };
            const typingInterval = setInterval(sendTyping, 8000);
            sendTyping();

            let response: BotResponse | null;
            try {
              response = await this.messageHandler(botMessage);
            } finally {
              clearInterval(typingInterval);
            }

            if (response) {
              if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('messageCreate:reply')) {
                logger.warn('Skip Discord reply after handler: token is not ready', {
                  isLoggedIn: this.isLoggedIn,
                  hasToken: Boolean(this.client.token),
                  channelId: message.channelId,
                });
                return;
              }

              if (isGuildChannel && !isMention) {
                // Guild channel (not a mention): reply to the original message
                await this.sendSplitReply(message, response);
              } else if (isMention) {
                await this.sendSplitReply(message, response);
              } else {
                // DM
                await this.sendSplitMessage(message.channelId, response);
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
          if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('interactionCreate:defer')) {
            logger.warn('Skip interaction processing: token is not ready', {
              isLoggedIn: this.isLoggedIn,
              hasToken: Boolean(this.client.token),
              commandName: interaction.commandName,
            });
            return;
          }

          await interaction.deferReply();
          const response = await handler(botMessage);
          if (response) {
            if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('interactionCreate:reply')) {
              logger.warn('Skip interaction reply: token is not ready', {
                isLoggedIn: this.isLoggedIn,
                hasToken: Boolean(this.client.token),
                commandName: interaction.commandName,
              });
              return;
            }
            const prepared = this.prepareResponsePayload(response);

            if (prepared.chunks.length === 0 && prepared.files.length === 0) {
              await interaction.editReply({ content: '(empty response)' });
            } else {
              await interaction.editReply(this.buildDiscordMessageOptions(prepared.chunks[0], prepared.files));
              // Remaining chunks as follow-up messages
              for (let i = 1; i < prepared.chunks.length; i++) {
                await interaction.followUp(this.buildDiscordMessageOptions(prepared.chunks[i]));
              }
            }
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
        logger.info('Discord bot username updated', { username: normalizedAgentName });
      }
    } catch (error) {
      logger.warn('Failed to update Discord bot username', { username: normalizedAgentName, error });
    }

    try {
      this.client.user.setActivity(`${normalizedAgentName} ready`);
    } catch (error) {
      logger.warn('Failed to update Discord bot presence', { error });
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

  /**
   * Split a long text into chunks that fit within Discord's content limit.
   * Splits at natural boundaries: code block closings, newlines, then spaces.
   */
  private splitText(text: string, maxLength: number = DISCORD_CONTENT_MAX_LENGTH): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitIndex = -1;
      const searchRange = remaining.slice(0, maxLength);

      // 1. Try to split at end of a code block (```)
      const codeBlockEnd = searchRange.lastIndexOf('\n```\n');
      if (codeBlockEnd > maxLength * 0.3) {
        splitIndex = codeBlockEnd + 4; // after "```\n"
      }

      // 2. Try to split at a blank line
      if (splitIndex < 0) {
        const blankLine = searchRange.lastIndexOf('\n\n');
        if (blankLine > maxLength * 0.3) {
          splitIndex = blankLine + 1;
        }
      }

      // 3. Try to split at a newline
      if (splitIndex < 0) {
        const newline = searchRange.lastIndexOf('\n');
        if (newline > maxLength * 0.3) {
          splitIndex = newline + 1;
        }
      }

      // 4. Try to split at a space
      if (splitIndex < 0) {
        const space = searchRange.lastIndexOf(' ');
        if (space > maxLength * 0.3) {
          splitIndex = space + 1;
        }
      }

      // 5. Hard split as last resort
      if (splitIndex < 0) {
        splitIndex = maxLength;
      }

      const chunk = remaining.slice(0, splitIndex);
      chunks.push(chunk);
      remaining = remaining.slice(splitIndex);

      // If a code block is open in this chunk but not closed, close it and
      // re-open in the next chunk so Discord renders both correctly.
      const backtickCount = (chunk.match(/```/g) || []).length;
      if (backtickCount % 2 !== 0) {
        chunks[chunks.length - 1] += '\n```';
        remaining = '```\n' + remaining;
      }
    }

    return chunks;
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
        typeof block.text.text === 'string'
          ? this.normalizeDiscordMarkdown(block.text.text)
          : '',
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

    const content = this.truncateText(this.normalizeDiscordMarkdown(response.text?.trim() || response.text || ''), DISCORD_CONTENT_MAX_LENGTH);
    return { content: content || '(empty response)' };
  }

  private logDiscordApiError(context: string, error: unknown): void {
    const apiError = error as { rawError?: { errors?: unknown } };
    if (apiError?.rawError?.errors) {
      logger.error('Discord API validation errors', undefined, {
        context,
        errors: JSON.stringify(apiError.rawError.errors, null, 2)
      });
    }
    logger.error('Discord handler error', error instanceof Error ? error : undefined, { context });
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('registerSlashCommands')) {
      logger.warn('Skip slash command registration: token is not ready', {
        isLoggedIn: this.isLoggedIn,
        hasToken: Boolean(this.client.token),
      });
      return;
    }

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
        name: 'agent-help',
        description: `Show ${normalizedAgentName} help`,
      },
      {
        name: 'agent-status',
        description: 'Show tool and repository status',
      },
      {
        name: 'agent-clear',
        description: 'Clear conversation context',
      },
      {
        name: 'agent-repo',
        description: 'Manage repository for this channel',
        options: [{
          name: 'prompt',
          type: 3,
          description: '<url> / status / create <name> / tool <name> / delete / reset',
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
        name: 'agent-tool',
        description: `Tool command: list / status / use <name> / clear / reset`,
        options: [{
          name: 'prompt',
          type: 3,
          description: 'list / status / use <name> / clear / reset',
          required: false,
        }],
      },
      {
        name: 'takt-run',
        description: 'Run TAKT pipeline task (non-interactive)',
        options: [{
          name: 'prompt',
          type: 3,
          description: 'Task description (optionally with --auto-pr, --provider, --piece flags)',
          required: true,
        }],
      },
      {
        name: 'orcha-run',
        description: 'Run orcha cycle on linked repository',
        options: [{
          name: 'prompt',
          type: 3,
          description: 'Task description or "status" (optionally with --profile, --no-timeout flags)',
          required: true,
        }],
      },
    ];

    try {
      await this.client.application?.commands.set(commands);
      logger.info('Discord slash commands registered');
    } catch (error) {
      this.logDiscordApiError('registerSlashCommands', error);
    }
  }

  async start(): Promise<void> {
    if (this.isLoggedIn) {
      logger.info('Discord bot is already running');
      return;
    }

    const normalizedToken = this.token?.trim();
    if (!normalizedToken) {
      throw new Error('DISCORD_BOT_TOKEN is empty');
    }

    await this.client.login(normalizedToken);
    this.client.rest.setToken(normalizedToken);
    this.isLoggedIn = true;
    logger.info('Discord bot starting');
  }

  async stop(): Promise<void> {
    this.isLoggedIn = false;
    await this.client.destroy();
    logger.info('Discord bot stopped');
  }

  private normalizeDiscordMarkdownSegment(text: string): string {
    return text
      .replace(/(^|\n)([ \t]*)•\s+/g, '$1$2- ')
      .replace(/(^|\n)([ \t]*)\*([^*\n]*[:：])\*/g, '$1$2**$3**');
  }

  private normalizeDiscordMarkdown(text: string): string {
    if (!text) {
      return text;
    }

    return text
      .split(DISCORD_CODE_BLOCK_PATTERN)
      .map((segment, index) => index % 2 === 1 ? segment : this.normalizeDiscordMarkdownSegment(segment))
      .join('');
  }

  /**
   * Extract the full text content from a BotResponse (blocks or text).
   */
  private extractResponseText(response: BotResponse): string {
    if (response.blocks && response.blocks.length > 0) {
      const texts = response.blocks
        .filter((b: any) => b?.type === 'section' && typeof b?.text?.text === 'string')
        .map((b: any) => this.normalizeDiscordMarkdown(b.text.text));
      if (texts.length > 0) {
        return texts.join('\n\n');
      }
    }
    return this.normalizeDiscordMarkdown(response.text || '');
  }

  private resolveImageAttachments(response: BotResponse): { attachments: DiscordImageAttachment[]; warnings: string[] } {
    const attachments: DiscordImageAttachment[] = [];
    const warnings: string[] = [];

    for (const attachment of response.attachments || []) {
      if (attachment.kind !== 'image') {
        continue;
      }

      if (!attachment.path) {
        if (attachment.url) {
          warnings.push(`⚠️ Discord ではローカル画像のみ添付できます: ${attachment.url}`);
        }
        continue;
      }

      const normalizedPath = path.resolve(attachment.path);
      if (!fs.existsSync(normalizedPath)) {
        warnings.push(`⚠️ 画像ファイルが見つからないため送信をスキップしました: ${path.basename(normalizedPath)}`);
        continue;
      }

      const stats = fs.statSync(normalizedPath);
      if (!stats.isFile()) {
        warnings.push(`⚠️ 画像ファイルとして扱えないため送信をスキップしました: ${path.basename(normalizedPath)}`);
        continue;
      }

      if (stats.size >= DISCORD_IMAGE_MAX_BYTES) {
        warnings.push(`⚠️ Discord では 5MB 未満の画像のみ送信できます: ${path.basename(normalizedPath)}`);
        continue;
      }

      attachments.push({
        path: normalizedPath,
        fileName: path.basename(normalizedPath)
      });
    }

    if (attachments.length > DISCORD_ATTACHMENTS_MAX_COUNT) {
      warnings.push(`⚠️ Discord では一度に ${DISCORD_ATTACHMENTS_MAX_COUNT} 件までしか画像を送信できないため、先頭 ${DISCORD_ATTACHMENTS_MAX_COUNT} 件のみ送信しました。`);
    }

    return {
      attachments: attachments.slice(0, DISCORD_ATTACHMENTS_MAX_COUNT),
      warnings
    };
  }

  private buildDiscordMessageOptions(content?: string, files: AttachmentBuilder[] = []): { content?: string; files?: AttachmentBuilder[] } {
    const payload: { content?: string; files?: AttachmentBuilder[] } = {};
    if (content) {
      payload.content = content;
    }
    if (files.length > 0) {
      payload.files = files;
    }
    return payload;
  }

  private prepareResponsePayload(response: BotResponse): { chunks: string[]; files: AttachmentBuilder[] } {
    const responseText = this.extractResponseText(response).trim();
    const resolvedAttachments = this.resolveImageAttachments(response);
    const mergedText = [responseText, ...resolvedAttachments.warnings]
      .filter(part => typeof part === 'string' && part.trim())
      .join('\n\n');

    return {
      chunks: mergedText ? this.splitText(mergedText) : [],
      files: resolvedAttachments.attachments.map(attachment => new AttachmentBuilder(attachment.path, { name: attachment.fileName }))
    };
  }

  /**
   * Send a response as multiple messages if it exceeds Discord limits.
   */
  private async sendSplitMessage(channelId: string, response: BotResponse): Promise<void> {
    const prepared = this.prepareResponsePayload(response);

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel || channel instanceof DMChannel)) {
      return;
    }

    if (prepared.chunks.length === 0 && prepared.files.length === 0) {
      await channel.send({ content: '(empty response)' });
      return;
    }

    await channel.send(this.buildDiscordMessageOptions(prepared.chunks[0], prepared.files));

    for (let i = 1; i < prepared.chunks.length; i++) {
      await channel.send(this.buildDiscordMessageOptions(prepared.chunks[i]));
    }
  }

  /**
   * Reply to a message, splitting into multiple messages if needed.
   * First chunk is a reply; subsequent chunks are follow-up messages.
   */
  private async sendSplitReply(originalMessage: Message, response: BotResponse): Promise<void> {
    const prepared = this.prepareResponsePayload(response);

    if (prepared.chunks.length === 0 && prepared.files.length === 0) {
      await originalMessage.reply({ content: '(empty response)', allowedMentions: { repliedUser: true } });
      return;
    }

    // First chunk as a reply
    await originalMessage.reply({
      ...this.buildDiscordMessageOptions(prepared.chunks[0], prepared.files),
      allowedMentions: { repliedUser: true },
    });

    // Remaining chunks as follow-up messages in the same channel
    const channel = originalMessage.channel;
    if ('send' in channel && typeof channel.send === 'function') {
      for (let i = 1; i < prepared.chunks.length; i++) {
        await channel.send(this.buildDiscordMessageOptions(prepared.chunks[i]));
      }
    }
  }

  async sendMessage(channelId: string, response: BotResponse): Promise<void> {
    try {
      if (!this.canSendDiscordRequest() || !this.ensureRestTokenConfigured('sendMessage')) {
        logger.warn('Skip sendMessage: token is not ready', {
          isLoggedIn: this.isLoggedIn,
          hasToken: Boolean(this.client.token),
          channelId,
        });
        return;
      }

      await this.sendSplitMessage(channelId, response);
    } catch (error) {
      this.logDiscordApiError('sendMessage', error);
    }
  }

  async sendThinkingMessage(channelId: string): Promise<void> {
    await this.sendMessage(channelId, { text: '🤔 処理中...' });
  }

  onMessage(handler: (message: BotMessage) => Promise<BotResponse | null>): void {
    this.messageHandler = handler;
  }

  onCommand(command: string, handler: (message: BotMessage) => Promise<BotResponse | null>): void {
    this.commandHandlers.set(command, handler);
  }
}
