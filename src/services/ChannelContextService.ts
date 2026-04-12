import * as fs from 'fs';
import * as path from 'path';

import { BotResponse } from '../interfaces/BotInterface';
import { ToolCLIClient } from '../toolCLIClient';
import { createLogger } from '../utils/logger';
import { GitCloneResult, GitService } from './GitService';
import { ChannelRepository, StorageService } from './StorageService';
import { ChannelToolPreference, ToolPreferenceService } from './ToolPreferenceService';

const logger = createLogger('ChannelContextService');

export interface ResolvedRepository {
  repository?: ChannelRepository;
  restored?: boolean;
  error?: string;
}

export class ChannelContextService {
  constructor(
    private readonly storageService: StorageService = new StorageService(),
    private readonly toolPreferenceService: ToolPreferenceService = new ToolPreferenceService(),
    private readonly gitService: GitService = new GitService()
  ) {}

  getToolNames(toolClient: ToolCLIClient): string[] {
    return toolClient.listTools().map(tool => tool.name);
  }

  buildUnknownToolResponse(toolName: string, toolClient: ToolCLIClient): BotResponse {
    const available = this.getToolNames(toolClient);
    return {
      text: `❌ 未対応ツール: ${toolName}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ 未対応ツール: \`${toolName}\`\n\n利用可能: ${available.map(name => `\`${name}\``).join(', ')}`
          }
        }
      ]
    };
  }

  getEffectiveToolName(channelId: string, toolClient: ToolCLIClient, requestedTool?: string): string {
    if (requestedTool) {
      return requestedTool;
    }

    const channelTool = this.toolPreferenceService.getChannelTool(channelId)?.toolName;
    if (channelTool) {
      if (toolClient.hasTool(channelTool)) {
        return channelTool;
      }
      logger.warn('Channel tool preference is stale (tool not registered), falling back to default', {
        channelId,
        staleTool: channelTool,
        defaultTool: toolClient.getDefaultToolName()
      });
    }

    return toolClient.getDefaultToolName();
  }

  getChannelToolPreference(channelId: string): ChannelToolPreference | undefined {
    return this.toolPreferenceService.getChannelTool(channelId);
  }

  setChannelTool(channelId: string, toolName: string): void {
    this.toolPreferenceService.setChannelTool(channelId, toolName);
  }

  clearChannelTool(channelId: string): boolean {
    return this.toolPreferenceService.clearChannelTool(channelId);
  }

  clearAllChannelTools(): number {
    return this.toolPreferenceService.clearAll();
  }

  getChannelRepository(channelId: string): ChannelRepository | undefined {
    return this.storageService.getChannelRepository(channelId);
  }

  getAllChannelRepositories(): Record<string, ChannelRepository> {
    return this.storageService.getAllChannelRepositories();
  }

  deleteChannelRepository(channelId: string): boolean {
    return this.storageService.deleteChannelRepository(channelId);
  }

  isRepositoryNameExists(repositoryName: string): boolean {
    return this.storageService.isRepositoryNameExists(repositoryName);
  }

  async createRepository(channelId: string, repositoryName: string): Promise<GitCloneResult> {
    const result = await this.gitService.createRepository(repositoryName, channelId);
    if (!result.success || !result.localPath) {
      return result;
    }

    this.storageService.setChannelRepository(channelId, `local://${repositoryName}`, result.localPath);
    this.addCodexTrust(result.localPath);
    return result;
  }

  async cloneRepository(channelId: string, repositoryUrl: string): Promise<GitCloneResult> {
    const result = await this.gitService.cloneRepository(repositoryUrl, channelId);
    if (!result.success || !result.localPath) {
      return result;
    }

    this.storageService.setChannelRepository(channelId, repositoryUrl, result.localPath);
    this.addCodexTrust(result.localPath);
    return result;
  }

  async getRepositoryStatus(localPath: string): Promise<{ success: boolean; status?: string; error?: string }> {
    return this.gitService.getRepositoryStatus(localPath);
  }

  async resolveChannelRepository(channelId: string): Promise<ResolvedRepository> {
    const repository = this.storageService.getChannelRepository(channelId);
    if (!repository) {
      return {};
    }

    if (this.gitService.repositoryExists(repository.localPath)) {
      return { repository };
    }

    if (repository.repositoryUrl.startsWith('local://')) {
      logger.warn('Locally-created repository is missing and cannot be re-cloned', {
        channelId,
        repositoryUrl: repository.repositoryUrl,
        missingLocalPath: repository.localPath
      });
      return {
        repository,
        error: 'ローカルリポジトリのディレクトリが見つかりません。`/agent-repo delete` で登録を削除してから再作成してください。'
      };
    }

    logger.warn('Repository localPath not found. Re-cloning linked repository', {
      channelId,
      repositoryUrl: repository.repositoryUrl,
      missingLocalPath: repository.localPath
    });

    const cloneResult = await this.cloneRepository(channelId, repository.repositoryUrl);
    if (!cloneResult.success || !cloneResult.localPath) {
      logger.error('Failed to re-clone repository for missing localPath', cloneResult.error, {
        channelId,
        repositoryUrl: repository.repositoryUrl,
        missingLocalPath: repository.localPath
      });
      return {
        repository,
        error: cloneResult.error || '不明なエラー'
      };
    }

    const restoredRepository = this.storageService.getChannelRepository(channelId);
    logger.info('Repository re-cloned and channel mapping updated', {
      channelId,
      repositoryUrl: repository.repositoryUrl,
      oldLocalPath: repository.localPath,
      newLocalPath: cloneResult.localPath
    });

    return {
      repository: restoredRepository,
      restored: true
    };
  }

  private addCodexTrust(localPath: string): void {
    try {
      const home = process.env.USERPROFILE || process.env.HOME || '';
      if (!home) {
        return;
      }

      const configPath = path.join(home, '.codex', 'config.toml');
      if (!fs.existsSync(configPath)) {
        return;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const resolved = path.resolve(localPath);
      const escapedResolvedPath = resolved.replace(/\\/g, '\\\\');
      const escapedLegacyWinPath = process.platform === 'win32'
        ? `\\\\?\\${resolved}`.replace(/\\/g, '\\\\')
        : '';
      if (
        content.includes(escapedResolvedPath) ||
        content.includes(resolved) ||
        (escapedLegacyWinPath && content.includes(escapedLegacyWinPath))
      ) {
        return;
      }

      const entry = `\n[projects.'${escapedResolvedPath}']\ntrust_level = "trusted"\n`;
      fs.appendFileSync(configPath, entry, 'utf-8');
      logger.info('Added codex trust for repository', { path: resolved });
    } catch (error) {
      logger.warn('Failed to add codex trust', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
