import { test } from 'node:test';
import assert from 'node:assert/strict';

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
