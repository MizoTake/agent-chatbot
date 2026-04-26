import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import { ToolResponse } from '../toolCLIClient';
import { PromptExecutionContext, PromptExecutionService } from './PromptExecutionService';

function createService(overrides: {
  sendPrompt?: (prompt: string, options: Record<string, unknown>) => Promise<ToolResponse>;
  storeSessionId?: (channelId: string, toolName: string, sessionId: string) => void;
} = {}): PromptExecutionService {
  const toolRuntimeService = {
    getToolClient: () => ({
      sendPrompt: overrides.sendPrompt || (async () => ({ response: '' }))
    }),
    isSkipPermissionsEnabled: () => false
  };
  const conversationSessionService = {
    storeSessionId: overrides.storeSessionId || (() => {})
  };
  const channelContextService = {};
  return new PromptExecutionService(
    toolRuntimeService as any,
    conversationSessionService as any,
    channelContextService as any
  );
}

function createContext(): PromptExecutionContext {
  return {
    channelId: 'C001',
    toolName: 'claude',
    workingDirectory: 'C:\\tmp'
  };
}

test('PromptExecutionService.parsePrompt: 空文字はエラーを返す', () => {
  const service = createService();
  const result = service.parsePrompt('');
  assert.ok(result.error);
  assert.equal(result.prompt, '');
});

test('PromptExecutionService.parsePrompt: 通常テキストはそのまま返す', () => {
  const service = createService();
  const result = service.parsePrompt('Hello, world!');
  assert.equal(result.prompt, 'Hello, world!');
  assert.equal(result.toolOverride, undefined);
});

test('PromptExecutionService.parsePrompt: --tool 指定を解析する', () => {
  const service = createService();
  const result = service.parsePrompt('--tool codex fix this bug');
  assert.equal(result.toolOverride, 'codex');
  assert.equal(result.prompt, 'fix this bug');
});

test('PromptExecutionService.buildBotResponse: Markdown のローカル画像を添付に変換する', () => {
  const service = createService();
  const buildBotResponse = (service as any).buildBotResponse.bind(service);
  const workingDirectory = path.join(process.cwd(), 'tmp-repo');

  const response = buildBotResponse(
    'codex',
    {
      response: '生成しました\n\n![chart](./artifacts/chart.png)'
    },
    false,
    workingDirectory
  );

  assert.equal(response.text, '生成しました');
  assert.deepEqual(response.attachments, [
    {
      kind: 'image',
      path: path.resolve(workingDirectory, 'artifacts/chart.png'),
      altText: 'chart'
    }
  ]);
  assert.equal(response.blocks[0].text.text, '生成しました');
});

test('PromptExecutionService.buildBotResponse: Markdown の画像リンクを本文を保ったまま添付に変換する', () => {
  const service = createService();
  const buildBotResponse = (service as any).buildBotResponse.bind(service);
  const imagePath = path.resolve('repositories/sample/screenshots/diagnostic_frame001.png').replace(/\\/g, '/');

  const response = buildBotResponse(
    'codex',
    {
      response: `スクリーンショットは [diagnostic_frame001.png](${imagePath}) です。`
    },
    false,
    undefined
  );

  assert.equal(response.text, 'スクリーンショットは diagnostic_frame001.png です。');
  assert.deepEqual(response.attachments, [
    {
      kind: 'image',
      path: path.normalize(imagePath),
      altText: 'diagnostic_frame001.png'
    }
  ]);
  assert.equal(response.blocks[0].text.text, 'スクリーンショットは diagnostic_frame001.png です。');
});

test('PromptExecutionService.recoverDisplayableResponse: 空応答でもセッションがあれば本文回収を試みる', async () => {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const storedSessions: Array<{ channelId: string; toolName: string; sessionId: string }> = [];
  const service = createService({
    sendPrompt: async (prompt, options) => {
      calls.push({ prompt, options });
      return {
        response: '回収した本文です。',
        sessionId: 'ses_recovered'
      };
    },
    storeSessionId: (channelId, toolName, sessionId) => {
      storedSessions.push({ channelId, toolName, sessionId });
    }
  });

  const result = await service.recoverDisplayableResponse(
    {
      response: '',
      sessionId: 'ses_empty'
    },
    createContext()
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /直前の応答が空でした/);
  assert.equal(calls[0].options.resumeConversation, true);
  assert.equal(calls[0].options.sessionId, 'ses_empty');
  assert.equal(result.response, '回収した本文です。');
  assert.deepEqual(storedSessions, [
    {
      channelId: 'C001',
      toolName: 'claude',
      sessionId: 'ses_recovered'
    }
  ]);
});

test('PromptExecutionService.recoverDisplayableResponse: 画像添付があれば空本文でも回収を試みない', async () => {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const service = createService({
    sendPrompt: async (prompt, options) => {
      calls.push({ prompt, options });
      return {
        response: 'unexpected'
      };
    }
  });

  const result = await service.recoverDisplayableResponse(
    {
      response: '',
      sessionId: 'ses_image_only',
      attachments: [
        {
          kind: 'image',
          path: 'artifacts/chart.png'
        }
      ]
    },
    createContext()
  );

  assert.equal(calls.length, 0);
  assert.equal(result.sessionId, 'ses_image_only');
  assert.equal(result.attachments?.length, 1);
});

test('PromptExecutionService.attemptFreshTextOnlyRetry: 新規セッションで本文のみの再試行を行う', async () => {
  const calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const storedSessions: Array<{ channelId: string; toolName: string; sessionId: string }> = [];
  const service = createService({
    sendPrompt: async (prompt, options) => {
      calls.push({ prompt, options });
      return {
        response: '新規セッションの本文です。',
        sessionId: 'ses_fresh'
      };
    },
    storeSessionId: (channelId, toolName, sessionId) => {
      storedSessions.push({ channelId, toolName, sessionId });
    }
  });

  const result = await service.attemptFreshTextOnlyRetry(
    '品質向上のためのリファクタリングをしてください',
    createContext()
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /追加のツール実行やファイル編集は行わず/);
  assert.match(calls[0].prompt, /品質向上のためのリファクタリングをしてください/);
  assert.equal(calls[0].options.resumeConversation, false);
  assert.equal(result.response, '新規セッションの本文です。');
  assert.deepEqual(storedSessions, [
    {
      channelId: 'C001',
      toolName: 'claude',
      sessionId: 'ses_fresh'
    }
  ]);
});
