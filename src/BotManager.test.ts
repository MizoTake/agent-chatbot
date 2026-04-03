import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotManager } from './BotManager';
import { ToolResponse } from './toolCLIClient';

function makeManager(): BotManager {
  return new BotManager();
}

function parsePrompt(manager: BotManager, text: string) {
  return (manager as any).parsePrompt(text);
}

test('BotManager.parsePrompt: 空文字はエラーを返す', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, '');
  assert.ok(result.error, 'Empty text should return an error');
  assert.equal(result.prompt, '');
});

test('BotManager.parsePrompt: 空白のみはエラーを返す', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, '   ');
  assert.ok(result.error, 'Whitespace-only text should return an error');
});

test('BotManager.parsePrompt: 通常テキストはそのまま返す', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, 'Hello, world!');
  assert.equal(result.prompt, 'Hello, world!');
  assert.equal(result.toolOverride, undefined);
  assert.equal(result.error, undefined);
});

test('BotManager.parsePrompt: 前後の空白をトリムする', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, '  hello  ');
  assert.equal(result.prompt, 'hello');
});

test('BotManager.parsePrompt: --tool フラグでツール上書きを解析する', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, '--tool codex fix this bug');
  assert.equal(result.toolOverride, 'codex');
  assert.equal(result.prompt, 'fix this bug');
  assert.equal(result.error, undefined);
});

test('BotManager.parsePrompt: --tool= 形式でツール上書きを解析する', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, '--tool=vibe-local refactor code');
  assert.equal(result.toolOverride, 'vibe-local');
  assert.equal(result.prompt, 'refactor code');
});

test('BotManager.parsePrompt: --tool 指定でプロンプトなしはエラーを返す', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, '--tool codex');
  assert.ok(result.error, 'Missing prompt after --tool should return error');
  assert.equal(result.prompt, '');
});

test('BotManager.parsePrompt: --tool 指定でプロンプトが空白のみはエラーを返す', () => {
  const manager = makeManager();
  const result = parsePrompt(manager, '--tool codex   ');
  assert.ok(result.error, 'Whitespace-only prompt after --tool should return error');
});

test('BotManager.recoverDisplayableResponse: 空応答でもセッションがあれば共通フォールバックで本文回収を試みる', async () => {
  const manager = makeManager() as any;
  const calls: Array<{ prompt: string; options: any }> = [];

  manager.skipPermissionsEnabled = false;
  manager.sessionMap = new Map<string, string>();
  manager.toolClient = {
    sendPrompt: async (prompt: string, options: any): Promise<ToolResponse> => {
      calls.push({ prompt, options });
      return {
        response: '回収した本文です。',
        sessionId: 'ses_recovered'
      };
    }
  };

  const result = await manager.recoverDisplayableResponse(
    {
      response: '',
      sessionId: 'ses_empty'
    },
    'claude',
    'C:\\tmp',
    'C001::claude'
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /直前の応答が空でした/);
  assert.equal(calls[0].options.resumeConversation, true);
  assert.equal(calls[0].options.sessionId, 'ses_empty');
  assert.equal(result.response, '回収した本文です。');
  assert.equal(manager.sessionMap.get('C001::claude'), 'ses_recovered');
});

test('BotManager.attemptFreshTextOnlyRetry: 新規セッションで本文のみの再試行を行う', async () => {
  const manager = makeManager() as any;
  const calls: Array<{ prompt: string; options: any }> = [];

  manager.skipPermissionsEnabled = false;
  manager.sessionMap = new Map<string, string>();
  manager.toolClient = {
    sendPrompt: async (prompt: string, options: any): Promise<ToolResponse> => {
      calls.push({ prompt, options });
      return {
        response: '新規セッションの本文です。',
        sessionId: 'ses_fresh'
      };
    }
  };

  const result = await manager.attemptFreshTextOnlyRetry(
    '品質向上のためのリファクタリングをしてください',
    'claude',
    'C:\\tmp',
    'C001::claude'
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /追加のツール実行やファイル編集は行わず/);
  assert.match(calls[0].prompt, /品質向上のためのリファクタリングをしてください/);
  assert.equal(calls[0].options.resumeConversation, false);
  assert.equal(result.response, '新規セッションの本文です。');
  assert.equal(manager.sessionMap.get('C001::claude'), 'ses_fresh');
});
