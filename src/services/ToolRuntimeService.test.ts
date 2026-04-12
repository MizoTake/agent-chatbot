import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ToolRuntimeService } from './ToolRuntimeService';

function createService(overrides: {
  toolClient?: Record<string, unknown>;
  lmStudioService?: Record<string, unknown>;
  skipPermissionsEnabled?: boolean;
} = {}): ToolRuntimeService {
  const service = Object.create(ToolRuntimeService.prototype) as any;

  service.toolClient = overrides.toolClient || {
    getDefaultToolName: () => 'claude',
    getToolInfo: () => undefined,
    cleanup: () => {}
  };
  service.lmStudioService = overrides.lmStudioService || {
    fetchModels: async () => [],
    warmupModel: async () => true
  };
  service.skipPermissionsEnabled = overrides.skipPermissionsEnabled || false;
  service.configLoadPromise = Promise.resolve();
  return service;
}

test('ToolRuntimeService: AGENT_CHATBOT_APP_NAME を最優先する', () => {
  const previous = process.env.AGENT_CHATBOT_APP_NAME;
  const previousDefaultTool = process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL;
  process.env.AGENT_CHATBOT_APP_NAME = 'discord-agent';
  process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL = 'codex';

  try {
    const service = createService();
    assert.equal(service.getAgentDisplayName(), 'discord-agent');
  } finally {
    process.env.AGENT_CHATBOT_APP_NAME = previous;
    process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL = previousDefaultTool;
  }
});

test('ToolRuntimeService: APP_NAME がなければ環境の default tool を使う', () => {
  const previous = process.env.AGENT_CHATBOT_APP_NAME;
  const previousDefaultTool = process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL;
  delete process.env.AGENT_CHATBOT_APP_NAME;
  process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL = 'codex';

  try {
    const service = createService();
    assert.equal(service.getAgentDisplayName(), 'codex');
  } finally {
    process.env.AGENT_CHATBOT_APP_NAME = previous;
    process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL = previousDefaultTool;
  }
});

test('ToolRuntimeService: 環境変数がなければ ToolCLIClient の default を使う', () => {
  const previous = process.env.AGENT_CHATBOT_APP_NAME;
  const previousDefaultTool = process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL;
  delete process.env.AGENT_CHATBOT_APP_NAME;
  delete process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL;

  try {
    const service = createService({
      toolClient: {
        getDefaultToolName: () => 'claude',
        getToolInfo: () => undefined,
        cleanup: () => {}
      }
    });
    assert.equal(service.getAgentDisplayName(), 'claude');
  } finally {
    process.env.AGENT_CHATBOT_APP_NAME = previous;
    process.env.AGENT_CHATBOT_TOOLS_DEFAULTTOOL = previousDefaultTool;
  }
});

test('ToolRuntimeService: skipPermissions を set/toggle で変更できる', () => {
  const service = createService();

  assert.equal(service.isSkipPermissionsEnabled(), false);
  service.setSkipPermissionsEnabled(true);
  assert.equal(service.isSkipPermissionsEnabled(), true);
  assert.equal(service.toggleSkipPermissions(), false);
  assert.equal(service.isSkipPermissionsEnabled(), false);
});

test('ToolRuntimeService: LMStudio を使わないツールは readiness チェックを素通りする', async () => {
  let fetchCount = 0;
  const service = createService({
    toolClient: {
      getDefaultToolName: () => 'claude',
      getToolInfo: () => ({ provider: 'openai' }),
      cleanup: () => {}
    },
    lmStudioService: {
      fetchModels: async () => {
        fetchCount++;
        return [];
      },
      warmupModel: async () => true
    }
  });

  const actual = await service.ensureToolReady('claude');
  assert.equal(actual, undefined);
  assert.equal(fetchCount, 0);
});

test('ToolRuntimeService: codex でモデル未取得ならエラーを返す', async () => {
  const previous = process.env.LMSTUDIO_URL;
  process.env.LMSTUDIO_URL = 'http://localhost:1234';

  try {
    const service = createService({
      toolClient: {
        getDefaultToolName: () => 'claude',
        getToolInfo: () => ({ provider: 'lmstudio' }),
        cleanup: () => {}
      },
      lmStudioService: {
        fetchModels: async () => [],
        warmupModel: async () => true
      }
    });

    const actual = await service.ensureToolReady('codex');
    assert.match(actual || '', /LMStudio が応答しません/);
  } finally {
    if (previous === undefined) {
      delete process.env.LMSTUDIO_URL;
    } else {
      process.env.LMSTUDIO_URL = previous;
    }
  }
});

test('ToolRuntimeService: LMStudio 利用ツールは取得したモデルで warmup する', async () => {
  const previous = process.env.LMSTUDIO_URL;
  process.env.LMSTUDIO_URL = 'http://localhost:1234';
  const warmed: Array<{ baseUrl: string; model: string }> = [];
  try {
    const service = createService({
      toolClient: {
        getDefaultToolName: () => 'claude',
        getToolInfo: () => ({ provider: 'lmstudio', model: 'custom-model' }),
        cleanup: () => {}
      },
      lmStudioService: {
        fetchModels: async () => ['fallback-model'],
        warmupModel: async (baseUrl: string, model: string) => {
          warmed.push({ baseUrl, model });
          return true;
        }
      }
    });

    const actual = await service.ensureToolReady('codex');

    assert.equal(actual, undefined);
    assert.deepEqual(warmed, [
      {
        baseUrl: 'http://localhost:1234',
        model: 'custom-model'
      }
    ]);
  } finally {
    if (previous === undefined) {
      delete process.env.LMSTUDIO_URL;
    } else {
      process.env.LMSTUDIO_URL = previous;
    }
  }
});
