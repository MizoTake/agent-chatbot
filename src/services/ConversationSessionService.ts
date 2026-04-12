export class ConversationSessionService {
  private readonly clearedChannels: Set<string> = new Set();
  private readonly sessionMap: Map<string, string> = new Map();

  private buildConversationKey(channelId: string, toolName: string): string {
    return `${channelId}::${toolName}`;
  }

  shouldResumeConversation(channelId: string): boolean {
    return !this.clearedChannels.has(channelId);
  }

  markConversationActive(channelId: string): void {
    this.clearedChannels.delete(channelId);
  }

  clearConversationState(channelId: string): number {
    const alreadyCleared = this.clearedChannels.has(channelId);
    this.clearedChannels.add(channelId);

    const prefix = `${channelId}::`;
    for (const key of this.sessionMap.keys()) {
      if (key.startsWith(prefix)) {
        this.sessionMap.delete(key);
      }
    }

    return alreadyCleared ? 0 : 1;
  }

  getSessionId(channelId: string, toolName: string): string | undefined {
    return this.sessionMap.get(this.buildConversationKey(channelId, toolName));
  }

  storeSessionId(channelId: string, toolName: string, sessionId: string): void {
    this.sessionMap.set(this.buildConversationKey(channelId, toolName), sessionId);
  }
}
