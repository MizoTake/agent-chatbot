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
      if (repo.repositoryUrl.toLowerCase().endsWith(normalizedInput)) {
        return true;
      }
    }

    return false;
  }
}