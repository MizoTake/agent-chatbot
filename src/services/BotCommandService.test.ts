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
  setChannelCodexModel?: (channelId: string, model: string) => void;
  getChannelCodexModel?: (channelId: string) => string | undefined;
  clearChannelCodexModel?: (channelId: string) => boolean;
  buildUnknownToolResponse?: (toolName: string) => any;
  isRepositoryNameExists?: (repositoryName: string) => boolean;
  cloneRepository?: (channelId: string, repositoryUrl: string) => Promise<any>;
  updateApplication?: (...args: any[]) => Promise<any>;
  restartApplication?: (...args: any[]) => any;
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
      getToolClient: () => toolClient,
      setSkipPermissionsEnabled: () => {},
      toggleSkipPermissions: () => false,
      isSkipPermissionsEnabled: () => false
    } as any,
    {
      getEffectiveToolName: () => 'claude',
      getChannelToolPreference: () => undefined,
      setChannelTool: overrides.setChannelTool || (() => {}),
      setChannelCodexModel: overrides.setChannelCodexModel || (() => {}),
      getChannelCodexModel: overrides.getChannelCodexModel || (() => undefined),
      clearChannelCodexModel: overrides.clearChannelCodexModel || (() => true),
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
    } as any,
    {
      updateApplication: overrides.updateApplication || (async () => ({ success: true, pulled: true, restartScheduled: true, summary: 'updated' })),
      restartApplication: overrides.restartApplication || (() => ({ success: true })),
      getUpdateStatus: async () => ({ success: true, summary: 'status' })
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

test('BotCommandService: /codex は codex ツール指定として委譲する', async () => {
  const bot = createFakeBot();
  const calls: Array<{ text: string; showToolPrefix: boolean }> = [];
  const service = createService({
    executePromptRequest: async (message, showToolPrefix) => {
      calls.push({ text: message.text, showToolPrefix });
      return { text: 'ok' };
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('codex');
  const response = await handler?.({
    text: 'fix it',
    channelId: 'C001'
  });

  assert.equal(response?.text, 'ok');
  assert.deepEqual(calls, [{ text: '--tool codex fix it', showToolPrefix: true }]);
});

test('BotCommandService: /goal は codex 用の goal プロンプトとして委譲する', async () => {
  const bot = createFakeBot();
  const calls: Array<{ text: string; showToolPrefix: boolean }> = [];
  const service = createService({
    executePromptRequest: async (message, showToolPrefix) => {
      calls.push({ text: message.text, showToolPrefix });
      return { text: 'ok' };
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('goal');
  const response = await handler?.({
    text: 'ログイン失敗を直す',
    channelId: 'C001'
  });

  assert.equal(response?.text, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].showToolPrefix, true);
  assert.match(calls[0].text, /^--tool codex /);
  assert.match(calls[0].text, /目標:\nログイン失敗を直す/);
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

test('BotCommandService: /codex-tool は agent-tool と同じ処理でツール設定を更新する', async () => {
  const bot = createFakeBot();
  const updates: Array<{ channelId: string; toolName: string }> = [];
  const service = createService({
    setChannelTool: (channelId, toolName) => {
      updates.push({ channelId, toolName });
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('codex-tool');
  const response = await handler?.({
    text: 'use codex',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /codex/);
  assert.deepEqual(updates, [{ channelId: 'C001', toolName: 'codex' }]);
});

test('BotCommandService: /codex-model use はチャンネル固定モデルを更新して会話状態をクリアする', async () => {
  const bot = createFakeBot();
  const updates: Array<{ channelId: string; model: string }> = [];
  const clearedChannels: string[] = [];
  const service = createService({
    setChannelCodexModel: (channelId, model) => {
      updates.push({ channelId, model });
    },
    clearConversationState: (channelId) => {
      clearedChannels.push(channelId);
      return 1;
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('codex-model');
  const response = await handler?.({
    text: 'use gpt-5.4',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /gpt-5\.4/);
  assert.deepEqual(updates, [{ channelId: 'C001', model: 'gpt-5.4' }]);
  assert.deepEqual(clearedChannels, ['C001']);
});

test('BotCommandService: /codex-model clear はチャンネル固定モデルを解除する', async () => {
  const bot = createFakeBot();
  const clearedModels: string[] = [];
  const service = createService({
    clearChannelCodexModel: (channelId) => {
      clearedModels.push(channelId);
      return true;
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('codex-model');
  const response = await handler?.({
    text: 'clear',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /解除/);
  assert.deepEqual(clearedModels, ['C001']);
});

test('BotCommandService: /agent-update はアプリ更新サービスへ委譲する', async () => {
  const bot = createFakeBot();
  const calls: string[] = [];
  const service = createService({
    updateApplication: async (action) => {
      calls.push(action);
      return {
        success: true,
        pulled: true,
        restartScheduled: true,
        summary: '更新して再起動を予約しました'
      };
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('agent-update');
  const response = await handler?.({
    text: '',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /更新して再起動を予約しました/);
  assert.deepEqual(calls, ['pull']);
});

test('BotCommandService: /codex-restart は再起動サービスへ委譲する', async () => {
  const bot = createFakeBot();
  let called = false;
  const service = createService({
    restartApplication: () => {
      called = true;
      return { success: true };
    }
  });
  service.register(bot as any);

  const handler = bot.commandHandlers.get('codex-restart');
  const response = await handler?.({
    text: '',
    channelId: 'C001'
  });

  assert.match(response?.text || '', /再起動/);
  assert.equal(called, true);
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
