import { BaseStorageService } from './BaseStorageService';

export interface ChannelToolPreference {
  channelId: string;
  toolName: string;
  createdAt: string;
  updatedAt: string;
}

export class ToolPreferenceService extends BaseStorageService<ChannelToolPreference> {
  constructor(storageFile: string = 'channel-tools.json') {
    super(storageFile);
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

  clearAll(): number {
    const count = this.data.size;
    this.data.clear();
    if (count > 0) {
      this.saveData();
    }
    return count;
  }
}
