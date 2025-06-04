import * as fs from 'fs';
import * as path from 'path';

export interface ChannelRepository {
  channelId: string;
  repositoryUrl: string;
  localPath: string;
  createdAt: string;
  updatedAt: string;
}

export class StorageService {
  private storageFile: string;
  private data: Map<string, ChannelRepository>;

  constructor(storageFile: string = 'channel-repos.json') {
    this.storageFile = path.resolve(process.cwd(), storageFile);
    this.data = new Map();
    this.loadData();
  }

  private loadData(): void {
    try {
      if (fs.existsSync(this.storageFile)) {
        const fileContent = fs.readFileSync(this.storageFile, 'utf-8');
        const jsonData = JSON.parse(fileContent);
        this.data = new Map(Object.entries(jsonData));
      }
    } catch (error) {
      console.error('Failed to load storage data:', error);
      this.data = new Map();
    }
  }

  private saveData(): void {
    try {
      const jsonData = Object.fromEntries(this.data);
      fs.writeFileSync(this.storageFile, JSON.stringify(jsonData, null, 2));
    } catch (error) {
      console.error('Failed to save storage data:', error);
    }
  }

  setChannelRepository(channelId: string, repositoryUrl: string, localPath: string): void {
    const now = new Date().toISOString();
    const existing = this.data.get(channelId);
    
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

  getAllChannelRepositories(): ChannelRepository[] {
    return Array.from(this.data.values());
  }
}