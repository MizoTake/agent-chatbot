import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorMessages } from './errorMessages';

// ─── getErrorInfo ─────────────────────────────────────────────────────────────

test('ErrorMessages.getErrorInfo: 既知のエラーコードでメッセージを返す', () => {
  const info = ErrorMessages.getErrorInfo('CLAUDE_NOT_FOUND');
  assert.ok(info.message.length > 0);
  assert.ok(info.solution);
});

test('ErrorMessages.getErrorInfo: 未知のエラーコードでデフォルトメッセージを返す', () => {
  const info = ErrorMessages.getErrorInfo('UNKNOWN_CODE_XYZ');
  assert.ok(info.message.length > 0);
});

test('ErrorMessages.getErrorInfo: すべての既知コードが有効なメッセージを持つ', () => {
  const codes = [
    'CLAUDE_NOT_FOUND',
    'AUTH_REQUIRED',
    'REPO_CLONE_FAILED',
    'REPO_NOT_FOUND',
    'PERMISSION_DENIED',
    'DISK_SPACE_LOW',
    'NETWORK_ERROR',
    'TIMEOUT',
    'INVALID_COMMAND',
    'RATE_LIMIT',
  ];
  for (const code of codes) {
    const info = ErrorMessages.getErrorInfo(code);
    assert.ok(info.message.length > 0, `${code} should have a message`);
  }
});

// ─── fromError ────────────────────────────────────────────────────────────────

test('ErrorMessages.fromError: ENOENT は CLAUDE_NOT_FOUND にマップされる', () => {
  const err = new Error('spawn ENOENT');
  const info = ErrorMessages.fromError(err);
  assert.equal(info.message, ErrorMessages.getErrorInfo('CLAUDE_NOT_FOUND').message);
});

test('ErrorMessages.fromError: permission denied は PERMISSION_DENIED にマップされる', () => {
  const err = new Error('Permission denied');
  const info = ErrorMessages.fromError(err);
  assert.equal(info.message, ErrorMessages.getErrorInfo('PERMISSION_DENIED').message);
});

test('ErrorMessages.fromError: timeout キーワードは TIMEOUT にマップされる', () => {
  // fromError は error.toString().toLowerCase() で "timeout" を検索する
  const err = new Error('Connection timeout exceeded');
  const info = ErrorMessages.fromError(err);
  assert.equal(info.message, ErrorMessages.getErrorInfo('TIMEOUT').message);
});

test('ErrorMessages.fromError: 未知のエラーはデフォルトメッセージを返す', () => {
  const err = new Error('something completely unexpected');
  const info = ErrorMessages.fromError(err);
  assert.ok(info.message.length > 0);
  assert.ok(info.solution?.includes('something completely unexpected'), 'solution should include original message');
});

// ─── format ───────────────────────────────────────────────────────────────────

test('ErrorMessages.format: メッセージを含む文字列を返す', () => {
  const info = { message: 'テストエラー', solution: '再試行してください' };
  const formatted = ErrorMessages.format(info);
  assert.ok(formatted.includes('テストエラー'));
  assert.ok(formatted.includes('再試行してください'));
});

test('ErrorMessages.format: solution がない場合も動作する', () => {
  const info = { message: 'エラー発生' };
  const formatted = ErrorMessages.format(info);
  assert.ok(formatted.includes('エラー発生'));
});

test('ErrorMessages.format: helpUrl がある場合は含まれる', () => {
  const info = { message: 'エラー', helpUrl: 'https://example.com/help' };
  const formatted = ErrorMessages.format(info);
  assert.ok(formatted.includes('https://example.com/help'));
});
