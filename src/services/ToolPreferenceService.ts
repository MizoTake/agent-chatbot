import * as fs from 'fs';
import * as path from 'path';

export interface ChannelToolPreference {
  channelId: string;
  toolName: string;
  createdAt: string;
  updatedAt: string;
}

export class ToolPreferenceService {
  private storageFile: string;
  private data: Map<string, ChannelToolPreference>;

  constructor(storageFile: string = 'channel-tools.json') {
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
      console.error('Failed to load tool preferences:', error);
      this.data = new Map();
    }
  }

  private saveData(): void {
    try {
      const jsonData = Object.fromEntries(this.data);
      fs.writeFileSync(this.storageFile, JSON.stringify(jsonData, null, 2));
    } catch (error) {
      console.error('Failed to save tool preferences:', error);
    }
  }

  setChannelTool(channelId: string, toolName: string): void {
    const now = new Date().toISOString();
    const existing = this.data.get(channelId);

    this.data.set(channelId, {
      channelId,
      toolName,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });

    this.saveData();
  }

  getChannelTool(channelId: string): ChannelToolPreference | undefined {
    return this.data.get(channelId);
  }

  clearChannelTool(channelId: string): boolean {
    const result = this.data.delete(channelId);
    if (result) {
      this.saveData();
    }
    return result;
  }
}
