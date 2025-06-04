export interface BotMessage {
  text: string;
  channelId: string;
  userId: string;
  isDirectMessage: boolean;
  isMention: boolean;
  isCommand: boolean;
  commandName?: string;
}

export interface BotResponse {
  text: string;
  blocks?: any[];
}

export interface BotInterface {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(channelId: string, response: BotResponse): Promise<void>;
  sendThinkingMessage(channelId: string): Promise<void>;
}

export interface BotAdapter extends BotInterface {
  onMessage(handler: (message: BotMessage) => Promise<BotResponse | null>): void;
  onCommand(command: string, handler: (message: BotMessage) => Promise<BotResponse | null>): void;
}