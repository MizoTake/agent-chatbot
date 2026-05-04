import { ConfigLoader } from '../config/configLoader';
import { ToolCLIClient, ToolConfig } from '../toolCLIClient';
import { createLogger } from '../utils/logger';
import { LMStudioService } from './LMStudioService';

const logger = createLogger('ToolRuntimeService');

export class ToolRuntimeService {
  private toolClient: ToolCLIClient;
  private skipPermissionsEnabled: boolean = false;
  private readonly configLoadPromise: Promise<void>;

  constructor(private readonly lmStudioService: LMStudioService = new LMStudioService()) {
    this.toolClient = new ToolCLIClient();
    this.configLoadPromise = this.loadConfig();
  }

  async ready(): Promise<void> {
    await this.configLoadPromise;
  }

  getToolClient(): ToolCLIClient {
    return this.toolClient;
  }

  isSkipPermissionsEnabled(): boolean {
    return this.skipPermissionsEnabled;
  }

  setSkipPermissionsEnabled(enabled: boolean): void {
    this.skipPermissionsEnabled = enabled;
  }

  toggleSkipPermissions(): boolean {
    this.skipPermissionsEnabled = !this.skipPermissionsEnabled;
    return this.skipPermissionsEnabled;
  }

  getAgentDisplayName(): string {
    const explicitName = process.env.AGENT_CHATBOT_APP_NAME?.trim();
    if (explicitName) {
      return explicitName;
    }

    const envDefaultTool = process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL?.trim();
    if (envDefaultTool) {
      return envDefaultTool;
    }

    return this.toolClient.getDefaultToolName();
  }

  async ensureToolReady(toolName: string): Promise<string | undefined> {
    const toolInfo = this.toolClient.getToolInfo(toolName);
    const usesLMStudio = toolInfo?.provider === 'lmstudio';
    if (!usesLMStudio) {
      return undefined;
    }

    const lmstudioUrl = process.env.LMSTUDIO_URL || 'http://localhost:1234';
    const models = await this.lmStudioService.fetchModels(lmstudioUrl);
    if (models.length === 0) {
      return `❌ [${toolName}] LMStudio が応答しません（${lmstudioUrl}）。LMStudio が起動中でモデルがロードされているか確認してください。`;
    }

    const targetModel = toolInfo?.model || models[0];
    await this.lmStudioService.warmupModel(lmstudioUrl, targetModel);
    return undefined;
  }

  cleanup(): void {
    this.toolClient.cleanup();
  }

  private async loadConfig(): Promise<void> {
    try {
      await ConfigLoader.load();
      logger.info('Configuration loaded successfully');

      const claudeCommand = process.env.CLAUDE_COMMAND || ConfigLoader.get('claude.command', 'claude');
      const timeout = ConfigLoader.get('claude.timeout', 3600000);
      const maxOutputSize = ConfigLoader.get('claude.maxOutputSize', 10485760);

      const opencodeCommand = process.env.OPENCODE_COMMAND || 'opencode-cli';
      const opencodeArgs = process.env.OPENCODE_ARGS?.split(' ') || ['run', '--format', 'json', '{prompt}'];

      const codexCommand = process.env.CODEX_COMMAND || 'codex';
      const codexProvider = process.env.CODEX_PROVIDER?.trim() || undefined;
      let codexModel = process.env.CODEX_MODEL || undefined;

      if (!codexModel && codexProvider === 'lmstudio') {
        const lmstudioUrl = process.env.LMSTUDIO_URL || 'http://localhost:1234';
        const models = await this.lmStudioService.fetchModels(lmstudioUrl);
        if (models.length > 0) {
          codexModel = models[0];
          logger.info('Auto-detected LMStudio model for codex', { model: codexModel, available: models });
        } else {
          logger.warn('LMStudio is not running or has no models loaded — codex will use provider default');
        }
      }

      const configuredTools = ConfigLoader.get<Record<string, ToolConfig>>('tools.definitions', {});
      const mergedTools: Record<string, ToolConfig> = {
        claude: {
          command: claudeCommand,
          args: ['--dangerously-skip-permissions', '--print', '--output-format', 'json', '{prompt}'],
          versionArgs: ['--version'],
          description: 'Anthropic Claude CLI',
          supportsSkipPermissions: true
        },
        codex: {
          command: codexCommand,
          args: ['exec', '--sandbox', 'danger-full-access', '{prompt}'],
          versionArgs: ['--version'],
          description: 'OpenAI Codex CLI',
          provider: codexProvider,
          model: codexModel
        },
        opencode: {
          command: opencodeCommand,
          args: opencodeArgs,
          versionArgs: ['--version'],
          description: 'OpenCode CLI',
          supportsSkipPermissions: false
        },
        ...configuredTools
      };

      const defaultTool = ConfigLoader.get('tools.defaultTool', 'claude');
      this.toolClient = new ToolCLIClient(mergedTools, defaultTool, timeout, maxOutputSize);
      this.skipPermissionsEnabled = ConfigLoader.get('claude.dangerouslySkipPermissions', false);
    } catch (error) {
      logger.error('Failed to load config', error);
    }
  }
}
