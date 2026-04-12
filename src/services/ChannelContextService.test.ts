import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ChannelContextService } from './ChannelContextService';

function createToolClient(overrides: Record<string, unknown> = {}) {
  return {
    listTools: () => [{ name: 'claude' }, { name: 'codex' }],
    hasTool: (toolName: string) => toolName === 'claude' || toolName === 'codex',
    getDefaultToolName: () => 'claude',
    ...overrides
  };
}

test('ChannelContextService: requestedTool を最優先で返す', () => {
  const service = new ChannelContextService(
    {} as any,
    { getChannelTool: () => ({ toolName: 'codex' }) } as any,
    {} as any
  );

  const actual = service.getEffectiveToolName('C001', createToolClient() as any, 'opencode');
  assert.equal(actual, 'opencode');
});

test('ChannelContextService: チャンネル固定ツールが有効ならそれを返す', () => {
  const service = new ChannelContextService(
    {} as any,
    { getChannelTool: () => ({ toolName: 'codex' }) } as any,
    {} as any
  );

  const actual = service.getEffectiveToolName('C001', createToolClient() as any);
  assert.equal(actual, 'codex');
});

test('ChannelContextService: 未登録の固定ツールはデフォルトへフォールバックする', () => {
  const service = new ChannelContextService(
    {} as any,
    { getChannelTool: () => ({ toolName: 'old-tool' }) } as any,
    {} as any
  );

  const actual = service.getEffectiveToolName('C001', createToolClient({
    hasTool: () => false,
    getDefaultToolName: () => 'claude'
  }) as any);
  assert.equal(actual, 'claude');
});

test('ChannelContextService: 未対応ツール応答に利用可能ツール一覧を含める', () => {
  const service = new ChannelContextService({} as any, {} as any, {} as any);
  const response = service.buildUnknownToolResponse('gemini', createToolClient() as any);

  assert.match(response.text, /未対応ツール/);
  assert.match(response.blocks?.[0]?.text?.text || '', /`claude`/);
  assert.match(response.blocks?.[0]?.text?.text || '', /`codex`/);
});

test('ChannelContextService: createRepository 成功時に local:// で保存する', async () => {
  const saved: Array<{ channelId: string; repositoryUrl: string; localPath: string }> = [];
  const service = new ChannelContextService(
    {
      setChannelRepository: (channelId: string, repositoryUrl: string, localPath: string) => {
        saved.push({ channelId, repositoryUrl, localPath });
      }
    } as any,
    {} as any,
    {
      createRepository: async () => ({ success: true, localPath: 'D:\\repos\\new-repo' })
    } as any
  );
  (service as any).addCodexTrust = () => {};

  const result = await service.createRepository('C001', 'new-repo');

  assert.equal(result.success, true);
  assert.deepEqual(saved, [
    {
      channelId: 'C001',
      repositoryUrl: 'local://new-repo',
      localPath: 'D:\\repos\\new-repo'
    }
  ]);
});

test('ChannelContextService: cloneRepository 成功時に元URLで保存する', async () => {
  const saved: Array<{ channelId: string; repositoryUrl: string; localPath: string }> = [];
  const service = new ChannelContextService(
    {
      setChannelRepository: (channelId: string, repositoryUrl: string, localPath: string) => {
        saved.push({ channelId, repositoryUrl, localPath });
      }
    } as any,
    {} as any,
    {
      cloneRepository: async () => ({ success: true, localPath: 'D:\\repos\\remote-repo' })
    } as any
  );
  (service as any).addCodexTrust = () => {};

  const result = await service.cloneRepository('C001', 'https://github.com/example/repo.git');

  assert.equal(result.success, true);
  assert.deepEqual(saved, [
    {
      channelId: 'C001',
      repositoryUrl: 'https://github.com/example/repo.git',
      localPath: 'D:\\repos\\remote-repo'
    }
  ]);
});

test('ChannelContextService: リポジトリ未設定なら空結果を返す', async () => {
  const service = new ChannelContextService(
    { getChannelRepository: () => undefined } as any,
    {} as any,
    {} as any
  );

  const actual = await service.resolveChannelRepository('C001');
  assert.deepEqual(actual, {});
});

test('ChannelContextService: ローカルに存在するリポジトリはそのまま返す', async () => {
  const repository = {
    channelId: 'C001',
    repositoryUrl: 'https://github.com/example/repo.git',
    localPath: 'D:\\repos\\repo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const service = new ChannelContextService(
    { getChannelRepository: () => repository } as any,
    {} as any,
    { repositoryExists: () => true } as any
  );

  const actual = await service.resolveChannelRepository('C001');
  assert.deepEqual(actual, { repository });
});

test('ChannelContextService: local:// の欠損リポジトリは再クローンせずエラーにする', async () => {
  const repository = {
    channelId: 'C001',
    repositoryUrl: 'local://sample',
    localPath: 'D:\\repos\\missing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const gitService = {
    repositoryExists: () => false
  };
  const service = new ChannelContextService(
    { getChannelRepository: () => repository } as any,
    {} as any,
    gitService as any
  );

  const actual = await service.resolveChannelRepository('C001');

  assert.equal(actual.repository, repository);
  assert.match(actual.error || '', /ローカルリポジトリ/);
});

test('ChannelContextService: 欠損したリモートリポジトリは再クローンして restored を返す', async () => {
  const originalRepository = {
    channelId: 'C001',
    repositoryUrl: 'https://github.com/example/repo.git',
    localPath: 'D:\\repos\\missing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  let currentRepository = originalRepository;

  const service = new ChannelContextService(
    {
      getChannelRepository: () => currentRepository,
      setChannelRepository: (_channelId: string, repositoryUrl: string, localPath: string) => {
        currentRepository = {
          ...currentRepository,
          repositoryUrl,
          localPath
        };
      }
    } as any,
    {} as any,
    {
      repositoryExists: () => false,
      cloneRepository: async () => ({ success: true, localPath: 'D:\\repos\\restored' })
    } as any
  );
  (service as any).addCodexTrust = () => {};

  const actual = await service.resolveChannelRepository('C001');

  assert.equal(actual.restored, true);
  assert.equal(actual.repository?.localPath, 'D:\\repos\\restored');
});

test('ChannelContextService: 再クローン失敗時は元のリポジトリとエラーを返す', async () => {
  const repository = {
    channelId: 'C001',
    repositoryUrl: 'https://github.com/example/repo.git',
    localPath: 'D:\\repos\\missing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
  const service = new ChannelContextService(
    { getChannelRepository: () => repository } as any,
    {} as any,
    {
      repositoryExists: () => false,
      cloneRepository: async () => ({ success: false, error: 'network failure' })
    } as any
  );
  (service as any).addCodexTrust = () => {};

  const actual = await service.resolveChannelRepository('C001');

  assert.equal(actual.repository, repository);
  assert.equal(actual.error, 'network failure');
});

test('ChannelContextService: addCodexTrust は Windows で \\?\\ なしのパスを書き込む', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-context-trust-'));
  const tempHome = path.join(tempDir, 'home');
  const codexDir = path.join(tempHome, '.codex');
  const configPath = path.join(codexDir, 'config.toml');
  const repoPath = path.join(tempDir, 'repositories', 'sample-repo');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(repoPath, { recursive: true });
  fs.writeFileSync(configPath, 'model = "gpt-5.4"\n', 'utf8');
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  const service = new ChannelContextService({} as any, {} as any, {} as any);

  try {
    (service as any).addCodexTrust(repoPath);

    const actual = fs.readFileSync(configPath, 'utf8');
    const escapedPath = path.resolve(repoPath).replace(/\\/g, '\\\\');
    assert.ok(actual.includes(`[projects.'${escapedPath}']`));
    assert.doesNotMatch(actual, /\\\\\?\\/);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('ChannelContextService: addCodexTrust は既存の legacy trust エントリがあれば追記しない', () => {
  if (process.platform !== 'win32') {
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-context-trust-legacy-'));
  const tempHome = path.join(tempDir, 'home');
  const codexDir = path.join(tempHome, '.codex');
  const configPath = path.join(codexDir, 'config.toml');
  const repoPath = path.join(tempDir, 'repositories', 'sample-repo');
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(repoPath, { recursive: true });
  const legacyPath = `\\\\?\\${path.resolve(repoPath)}`.replace(/\\/g, '\\\\');
  fs.writeFileSync(configPath, `model = "gpt-5.4"\n\n[projects.'${legacyPath}']\ntrust_level = "trusted"\n`, 'utf8');
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  const service = new ChannelContextService({} as any, {} as any, {} as any);

  try {
    (service as any).addCodexTrust(repoPath);

    const actual = fs.readFileSync(configPath, 'utf8');
    const sectionCount = (actual.match(/\[projects\.'/g) || []).length;
    assert.equal(sectionCount, 1);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
