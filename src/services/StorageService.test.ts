import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { test } from 'node:test';
import assert = require('node:assert');
import { StorageService, ChannelRepository } from './StorageService';

test('StorageService: isRepositoryNameExists で既存の名前を検出できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C001', 'https://github.com/test/repo', '/test/path');

    const exists = service.isRepositoryNameExists('repo');
    assert.ok(exists, 'Existing repository name should be detected');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: isRepositoryNameExists で存在しない名前を判定できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C001', 'https://github.com/test/repo', '/test/path');

    const exists = service.isRepositoryNameExists('new-repo');
    assert.ok(!exists, 'Non-existing repository name should return false');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: isRepositoryNameExists で空の名前を拒否できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C001', 'https://github.com/test/repo', '/test/path');

    const exists = service.isRepositoryNameExists('');
    assert.ok(!exists, 'Empty repository name should return false');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: isRepositoryNameExists で無効な形式の名前を拒否できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C001', 'https://github.com/test/repo', '/test/path');

    const exists = service.isRepositoryNameExists('..\\..\\evil');
    assert.ok(!exists, 'Path traversal attempt should return false');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: isRepositoryNameExists で特殊文字を含む名前を拒否できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C001', 'https://github.com/test/repo', '/test/path');

    const exists = service.isRepositoryNameExists('repo with spaces & special!@#chars');
    assert.ok(!exists, 'Special characters should return false');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: isRepositoryNameExists で正規化された名前を一致判定できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C001', 'https://github.com/test/Test-Repo', '/test/path');

    const exists = service.isRepositoryNameExists('Test-Repo');
    assert.ok(exists, 'Normalized repository name should match');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: isRepositoryNameExists で SSH URL と .git 付きURLを一致判定できる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C001', 'git@github.com:test-org/Test-Repo.git', '/test/path');

    const exists = service.isRepositoryNameExists('test-repo');
    assert.ok(exists, 'SSH URL with .git suffix should match normalized repository name');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: setChannelRepository と getChannelRepository が正しく動作する', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C100', 'https://github.com/org/project', '/repos/project');

    const repo = service.getChannelRepository('C100');
    assert.ok(repo, 'Repository should be retrievable');
    assert.equal(repo!.channelId, 'C100');
    assert.equal(repo!.repositoryUrl, 'https://github.com/org/project');
    assert.equal(repo!.localPath, '/repos/project');
    assert.ok(repo!.createdAt, 'createdAt should be set');
    assert.ok(repo!.updatedAt, 'updatedAt should be set');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: 同一チャンネルの更新で createdAt が保持される', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C200', 'https://github.com/org/repo1', '/repos/repo1');
    const first = service.getChannelRepository('C200')!;

    service.setChannelRepository('C200', 'https://github.com/org/repo2', '/repos/repo2');
    const second = service.getChannelRepository('C200')!;

    assert.equal(second.createdAt, first.createdAt, 'createdAt should be preserved on update');
    assert.equal(second.repositoryUrl, 'https://github.com/org/repo2', 'URL should be updated');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: deleteChannelRepository が削除結果を返す', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C300', 'https://github.com/org/repo', '/repos/repo');

    const deleted = service.deleteChannelRepository('C300');
    const deletedAgain = service.deleteChannelRepository('C300');

    assert.equal(deleted, true);
    assert.equal(deletedAgain, false);
    assert.equal(service.getChannelRepository('C300'), undefined);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: getAllChannelRepositories が全エントリを返す', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service = new StorageService(storageFile);
    service.setChannelRepository('C401', 'https://github.com/a/repo1', '/repos/repo1');
    service.setChannelRepository('C402', 'https://github.com/b/repo2', '/repos/repo2');

    const all = service.getAllChannelRepositories();
    assert.equal(Object.keys(all).length, 2);
    assert.ok(all['C401']);
    assert.ok(all['C402']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('StorageService: 永続化ファイルから再読み込みできる', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
  const storageFile = path.join(tempDir, 'channel-repos.json');

  try {
    const service1 = new StorageService(storageFile);
    service1.setChannelRepository('C500', 'https://github.com/org/repo', '/repos/repo');

    const service2 = new StorageService(storageFile);
    const repo = service2.getChannelRepository('C500');
    assert.ok(repo, 'Repository should be reloaded from file');
    assert.equal(repo!.repositoryUrl, 'https://github.com/org/repo');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
