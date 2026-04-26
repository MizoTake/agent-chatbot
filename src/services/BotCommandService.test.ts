import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BotCommandService } from './BotCommandService';

interface FakeBot {
  messageHandler?: (message: any) => Promise<any>;
  commandHandlers: Map<string, (message: any) => Promise<any>>;
  sentMessages: Array<{ channelId: string; response: any }>;
}

function createFakeBot(): FakeBot & { sendMessage: (channelId: string, response: any) => Promise<void>; onMessage: (handler: any) => void; onCommand: (command: string, handler: any) => void; } {
  return {
    commandHandlers: new Map(),
    sentMessages: [],
    async sendMessage(channelId: string, response: any) {
      this.sentMessages.push({ channelId, response });
    },
    onMessage(handler: any) {
      this.messageHandler = handler;
    },
    onCommand(command: string, handler: any) {
      this.commandHandlers.set(command, handler);
    }
  };
}

function createService(overrides: {
  executePromptRequest?: (...args: any[]) => Promise<any>;
  toolClient?: Record<string, unknown>;
  clearConversationState?: (channelId: string) => number;
  setChannelTool?: (channelId: string, toolName: string) => void;
  buildUnknownToolResponse?: (toolName: string) => any;
  isRepositoryNameExists?: (repositoryName: string) => boolean;
  cloneRepository?: (channelId: string, repositoryUrl: string) => Promise<any>;
} = {}): BotCommandService {
  const toolClient = {
    listTools: () => [{ name: 'claude', command: 'claude' }, { name: 'codex', command: 'codex' }],
    hasTool: (toolName: string) => toolName === 'claude' || toolName === 'codex',
    getDefaultToolName: () => 'claude',
    checkAvailability: async () => true,
    ...overrides.toolClient
  };

  return new BotCommandService(
    {
      executePromptRequest: overrides.executePromptRequest || (async () => ({ text: 'ok' }))
    } as any,
    {
      runTakt: async () => ({ text: 'takt' }),
      runOrcha: async () => ({ text: 'orcha' })
    } as any,
    {
      getToolClient: () => toolClient,
      setSkipPermissionsEnabled: () => {},
      toggleSkipPermissions: () => false,
      isSkipPermissionsEnabled: () => false
    } as any,
    {
      getEffectiveToolName: () => 'claude',
      getChannelToolPreference: () => undefined,
      setChannelTool: overrides.setChannelTool || (() => {}),
      clearChannelTool: () => true,
      clearAllChannelTools: () => 2,
      buildUnknownToolResponse: overrides.buildUnknownToolResponse || ((toolName: string) => ({ text: `unknown:${toolName}` })),
      getChannelRepository: () => undefined,
      resolveChannelRepository: async () => ({}),
      getRepositoryStatus: async () => ({ success: true, status: 'clean' }),
      deleteChannelRepository: () => true,
      getAllChannelRepositories: () => ({}),
      isRepositoryNameExists: overrides.isRepositoryNameExists || (() => false),
      createRepository: async () => ({ success: true, localPath: 'repo' }),
      cloneRepository: overrides.cloneRepository || (async () => ({ success: true, localPath: 'repo' }))
    } as any,
    {
      clearConversationState: overrides.clearConversationState || (() => 1)
    } as any
  );
}

test('BotCommandService: 空メッセージはガイダンスを返す', async () => {
  const bot = createFakeBot();
  const service = createService();
  service.register(bot as any);

  const response = await bot.messageHandler?.({
    text: '',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /How can I help/);
});

test('BotCommandService: 通常メッセージは PromptExecutionService に委譲する', async () => {
  const bot = createFakeBot();
  const calls: Array<{ message: any; showToolPrefix: boolean }> = [];
  const service = createService({
    executePromptRequest: async (message, showToolPrefix, notify) => {
      calls.push({ message, showToolPrefix });
      await notify({ text: 'bg' });
      return { text: 'main' };
    }
  });
  service.register(bot as any);

  const response = await bot.messageHandler?.({
    text: 'hello',
    channelId: 'C001'
  });

  assert.equal(response?.text, 'main');
  assert.deepEqual(calls, [
    {
      message: {
        text: 'hello',
        channelId: 'C001'
      },
      showToolPrefix: false
    }
  ]);
  assert.deepEqual(bot.sentMessages, [
    {
      channelId: 'C001',
      response: { text: 'bg' }
    }
  ]);
});

test('BotCommandService: /agent は showToolPrefix=true で委譲する', async () => {
  const bot = createFakeBot();
  const calls: Array<boolean> = [];
  const service = createService({
    executePromptRequest: async (_message, showToolPrefix) => {
      calls.push(showToolPrefix);
      return { text: 'ok' };
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('agent');
  const response = await handler?.({
    text: 'fix it',
    channelId: 'C001'
  });

  assert.equal(response?.text, 'ok');
  assert.deepEqual(calls, [true]);
});

test('BotCommandService: /agent-tool use はチャンネル固定ツールを更新する', async () => {
  const bot = createFakeBot();
  const updates: Array<{ channelId: string; toolName: string }> = [];
  const service = createService({
    setChannelTool: (channelId, toolName) => {
      updates.push({ channelId, toolName });
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('agent-tool');
  const response = await handler?.({
    text: 'use codex',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /codex/);
  assert.deepEqual(updates, [{ channelId: 'C001', toolName: 'codex' }]);
});

test('BotCommandService: /agent-tool use で未知ツールなら unknown response を返す', async () => {
  const bot = createFakeBot();
  const service = createService({
    toolClient: {
      hasTool: () => false
    },
    buildUnknownToolResponse: (toolName: string) => ({ text: `unknown:${toolName}` })
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('agent-tool');
  const response = await handler?.({
    text: 'use gemini',
    channelId: 'C001'
  });

  assert.equal(response?.text, 'unknown:gemini');
});

test('BotCommandService: /agent-repo は SSH URL をクローン対象として受け付ける', async () => {
  const bot = createFakeBot();
  const cloneCalls: Array<{ channelId: string; repositoryUrl: string }> = [];
  const service = createService({
    cloneRepository: async (channelId, repositoryUrl) => {
      cloneCalls.push({ channelId, repositoryUrl });
      return { success: true, localPath: 'repo' };
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('agent-repo');
  const response = await handler?.({
    text: 'git@github.com:example/repo.git',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /クローン/);
  assert.deepEqual(cloneCalls, [{ channelId: 'C001', repositoryUrl: 'git@github.com:example/repo.git' }]);
});

test('BotCommandService: /agent-clear は conversation state の件数を表示する', async () => {
  const bot = createFakeBot();
  const service = createService({
    clearConversationState: () => 3
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('agent-clear');
  const response = await handler?.({
    text: '',
    channelId: 'C001'
  });

  assert.match(response?.blocks?.[0]?.text?.text || '', /3件/);
});

test('BotCommandService: /agent-skip-permissions の不正値は使い方を返す', async () => {
  const bot = createFakeBot();
  const service = createService();
  service.register(bot as any);

  const handler = bot.commandHandlers.get('agent-skip-permissions');
  const response = await handler?.({
    text: 'invalid',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /無効なパラメータ/);
  assert.match(response?.blocks?.[0]?.text?.text || '', /使用方法/);
});
