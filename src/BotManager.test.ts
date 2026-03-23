import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotManager } from './BotManager';

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
