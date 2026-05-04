import { DiscordAdapter } from './adapters/DiscordAdapter';
import { createLogger } from './utils/logger';
import { BotCommandService } from './services/BotCommandService';
import { ChannelContextService } from './services/ChannelContextService';
import { ConversationSessionService } from './services/ConversationSessionService';
import { PromptExecutionService } from './services/PromptExecutionService';
import { ToolRuntimeService } from './services/ToolRuntimeService';

const logger = createLogger('BotManager');

export class BotManager {
  private discordBot?: DiscordAdapter;
  private readonly toolRuntimeService: ToolRuntimeService;
  private readonly commandService: BotCommandService;

  constructor() {
    this.toolRuntimeService = new ToolRuntimeService();

    const channelContextService = new ChannelContextService();
    const conversationSessionService = new ConversationSessionService();
    const promptExecutionService = new PromptExecutionService(
      this.toolRuntimeService,
      conversationSessionService,
      channelContextService
    );
    this.commandService = new BotCommandService(
      promptExecutionService,
      this.toolRuntimeService,
      channelContextService,
      conversationSessionService
    );
  }

  addDiscordBot(token: string): void {
    this.discordBot = new DiscordAdapter(token, this.toolRuntimeService.getAgentDisplayName());
    this.commandService.register(this.discordBot);
  }

  async startAll(): Promise<void> {
    await this.toolRuntimeService.ready();

    const agentDisplayName = this.toolRuntimeService.getAgentDisplayName();
    if (this.discordBot) {
      this.discordBot.setAgentName?.(agentDisplayName);
    }

    logger.info('Starting configured bots', { hasDiscordBot: !!this.discordBot, agentDisplayName });

    const toolClient = this.toolRuntimeService.getToolClient();
    const tools = toolClient.listTools();
    const statuses = await Promise.all(
      tools.map(async (tool) => ({
        name: tool.name,
        available: await toolClient.checkAvailability(tool.name)
      }))
    );

    statuses.forEach(status => {
      logger.info('Tool CLI availability check', status);
      if (!status.available) {
        logger.warn('Tool CLI not found', { tool: status.name });
      }
    });

    if (!this.discordBot) {
      logger.warn('No bot instance configured');
      return;
    }

    await this.discordBot.start();
    logger.info('Discord bot started');
  }

  async stopAll(): Promise<void> {
    logger.info('Stopping configured bots');
    if (this.discordBot) {
      await this.discordBot.stop();
    }
    this.toolRuntimeService.cleanup();
    logger.info('Bot shutdown completed');
  }
}
