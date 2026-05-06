import { BaseStorageService } from './BaseStorageService';

export interface ChannelToolPreference {
  channelId: string;
  toolName: string;
  codexModel?: string;
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

  setChannelCodexModel(channelId: string, codexModel: string): void {
    const now = new Date().toISOString();
    const existing = this.data.get(channelId);

    this.data.set(channelId, {
      channelId,
      toolName: existing?.toolName || '',
      codexModel,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });

    this.saveData();
  }

  getChannelCodexModel(channelId: string): string | undefined {
    return this.data.get(channelId)?.codexModel;
  }

  clearChannelCodexModel(channelId: string): boolean {
    const existing = this.data.get(channelId);
    if (!existing?.codexModel) {
      return false;
    }

    delete existing.codexModel;
    existing.updatedAt = new Date().toISOString();
    if (!existing.toolName) {
      this.data.delete(channelId);
    } else {
      this.data.set(channelId, existing);
    }
    this.saveData();
    return true;
  }

  clearChannelTool(channelId: string): boolean {
    const existing = this.data.get(channelId);
    if (!existing?.toolName) {
      return false;
    }

    if (existing.codexModel) {
      existing.toolName = '';
      existing.updatedAt = new Date().toISOString();
      this.data.set(channelId, existing);
    } else {
      this.data.delete(channelId);
    }
    this.saveData();
    return true;
  }

  clearAll(): number {
    let count = 0;
    for (const [channelId, preference] of this.data.entries()) {
      if (!preference.toolName) {
        continue;
      }

      count++;
      if (preference.codexModel) {
        this.data.set(channelId, {
          ...preference,
          toolName: '',
          updatedAt: new Date().toISOString()
        });
      } else {
        this.data.delete(channelId);
      }
    }

    if (count > 0) {
      this.saveData();
    }
    return count;
  }
}
