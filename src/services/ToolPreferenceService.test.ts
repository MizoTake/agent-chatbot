import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ToolPreferenceService } from './ToolPreferenceService';

test('ToolPreferenceService: set/getでチャンネル既定ツールを保持できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-pref-'));
  const filePath = path.join(tempDir, 'channel-tools.json');

  try {
    const service = new ToolPreferenceService(filePath);
    service.setChannelTool('C001', 'gemini');

    const pref = service.getChannelTool('C001');
    assert.equal(pref?.channelId, 'C001');
    assert.equal(pref?.toolName, 'gemini');
    assert.ok(pref?.createdAt);
    assert.ok(pref?.updatedAt);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ToolPreferenceService: 永続化ファイルから再読み込みできる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-pref-'));
  const filePath = path.join(tempDir, 'channel-tools.json');

  try {
    const service1 = new ToolPreferenceService(filePath);
    service1.setChannelTool('C002', 'aider');

    const service2 = new ToolPreferenceService(filePath);
    const pref = service2.getChannelTool('C002');
    assert.equal(pref?.toolName, 'aider');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ToolPreferenceService: clearChannelToolが削除結果を返す', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-pref-'));
  const filePath = path.join(tempDir, 'channel-tools.json');

  try {
    const service = new ToolPreferenceService(filePath);
    service.setChannelTool('C003', 'claude');

    const cleared = service.clearChannelTool('C003');
    const clearedAgain = service.clearChannelTool('C003');

    assert.equal(cleared, true);
    assert.equal(clearedAgain, false);
    assert.equal(service.getChannelTool('C003'), undefined);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ToolPreferenceService: Codex モデルをチャンネル別に保持して解除できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-prefs-'));
  const storageFile = path.join(tempDir, 'channel-tools.json');

  try {
    const service = new ToolPreferenceService(storageFile);
    service.setChannelCodexModel('C001', 'gpt-5.4');
    assert.equal(service.getChannelCodexModel('C001'), 'gpt-5.4');

    const reloaded = new ToolPreferenceService(storageFile);
    assert.equal(reloaded.getChannelCodexModel('C001'), 'gpt-5.4');
    assert.equal(reloaded.clearChannelCodexModel('C001'), true);
    assert.equal(reloaded.getChannelCodexModel('C001'), undefined);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ToolPreferenceService: ツール固定解除では Codex モデル設定を保持する', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-prefs-'));
  const storageFile = path.join(tempDir, 'channel-tools.json');

  try {
    const service = new ToolPreferenceService(storageFile);
    service.setChannelTool('C001', 'codex');
    service.setChannelCodexModel('C001', 'gpt-5.4');

    assert.equal(service.clearChannelTool('C001'), true);
    assert.equal(service.getChannelTool('C001')?.toolName, '');
    assert.equal(service.getChannelCodexModel('C001'), 'gpt-5.4');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
