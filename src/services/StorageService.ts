import * as path from 'path';
import { BaseStorageService } from './BaseStorageService';

export interface ChannelRepository {
  channelId: string;
  repositoryUrl: string;
  localPath: string;
  createdAt: string;
  updatedAt: string;
}

export class StorageService extends BaseStorageService<ChannelRepository> {
  constructor(storageFile: string = 'channel-repos.json') {
    super(storageFile);
  }

  setChannelRepository(channelId: string, repositoryUrl: string, localPath: string): void {
    const now = new Date().toISOString();
    const existing = this.data.get(channelId);
    
    // For locally-created repositories, use 'local://' format
    if (!repositoryUrl || repositoryUrl === '') {
      // Extract repo name from localPath and create local:// URL
      const repoName = path.basename(localPath).replace(/-\d+$/, '');
      repositoryUrl = `local://${repoName}`;
    }
    
    this.data.set(channelId, {
      channelId,
      repositoryUrl,
      localPath,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    
    this.saveData();
  }

  getChannelRepository(channelId: string): ChannelRepository | undefined {
    return this.data.get(channelId);
  }

  deleteChannelRepository(channelId: string): boolean {
    const result = this.data.delete(channelId);
    if (result) {
      this.saveData();
    }
    return result;
  }

getAllChannelRepositories(): Record<string, ChannelRepository> {
    return Object.fromEntries(this.data);
  }

  isRepositoryNameExists(repositoryName: string): boolean {
    if (!repositoryName || typeof repositoryName !== 'string') {
      return false;
    }

    const normalizedInput = repositoryName.trim().toLowerCase();
    if (normalizedInput === '') {
      return false;
    }

    if (normalizedInput.includes('..') || /[^a-zA-Z0-9\-_]/.test(normalizedInput)) {
      return false;
    }

    for (const repo of this.data.values()) {
      if (this.extractNormalizedRepositoryName(repo) === normalizedInput) {
        return true;
      }
    }

    return false;
  }

  private extractNormalizedRepositoryName(repository: ChannelRepository): string | null {
    const repositoryUrl = repository.repositoryUrl.trim();
    const localPrefix = 'local://';
    if (repositoryUrl.toLowerCase().startsWith(localPrefix)) {
      return repositoryUrl.slice(localPrefix.length).trim().toLowerCase();
    }

    const normalizedUrl = repositoryUrl.replace(/\/+$/, '');
    const match = normalizedUrl.match(/([^/:]+?)(?:\.git)?$/);
    if (!match?.[1]) {
      return null;
    }

    const normalizedRepositoryName = match[1].toLowerCase().replace(/[^a-z0-9\-_]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    return normalizedRepositoryName || null;
  }
}
