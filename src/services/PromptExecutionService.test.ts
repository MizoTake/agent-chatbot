import { test } from 'node:test';
import assert from 'node:assert/strict';

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
