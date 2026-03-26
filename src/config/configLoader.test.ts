import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigLoader } from './configLoader';

// ─── parseSize ────────────────────────────────────────────────────────────────

test('ConfigLoader.parseSize: バイト数をパースする', () => {
  assert.equal(ConfigLoader.parseSize('100'), 100);
  assert.equal(ConfigLoader.parseSize('100B'), 100);
});

test('ConfigLoader.parseSize: KB をパースする', () => {
  assert.equal(ConfigLoader.parseSize('10KB'), 10 * 1024);
  assert.equal(ConfigLoader.parseSize('1kb'), 1024);
});

test('ConfigLoader.parseSize: MB をパースする', () => {
  assert.equal(ConfigLoader.parseSize('10MB'), 10 * 1024 * 1024);
});

test('ConfigLoader.parseSize: GB をパースする', () => {
  assert.equal(ConfigLoader.parseSize('1GB'), 1024 * 1024 * 1024);
});

test('ConfigLoader.parseSize: 小数をパースする', () => {
  const result = ConfigLoader.parseSize('1.5MB');
  assert.equal(result, Math.floor(1.5 * 1024 * 1024));
});

test('ConfigLoader.parseSize: 無効なフォーマットは null を返す', () => {
  assert.equal(ConfigLoader.parseSize('invalid'), null);
  assert.equal(ConfigLoader.parseSize('10XB'), null);
  assert.equal(ConfigLoader.parseSize(''), null);
  assert.equal(ConfigLoader.parseSize('-10MB'), null);
});

// ─── get (デフォルト値) ───────────────────────────────────────────────────────

test('ConfigLoader.get: 設定が存在しない場合はデフォルト値を返す', async () => {
  // Reset state to ensure no config is loaded from disk for these unit tests
  await ConfigLoader.reload();

  const value = ConfigLoader.get('nonexistent.key', 'default-value');
  assert.equal(value, 'default-value');
});

test('ConfigLoader.get: デフォルト値が数値の場合も正しく返す', async () => {
  const value = ConfigLoader.get('nonexistent.number', 42);
  assert.equal(value, 42);
});

test('ConfigLoader.get: デフォルト値が真偽値の場合も正しく返す', async () => {
  const value = ConfigLoader.get('nonexistent.bool', false);
  assert.equal(value, false);
});
