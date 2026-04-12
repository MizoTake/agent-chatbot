import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorkflowRunnerService } from './WorkflowRunnerService';

function createService(overrides: {
  toolClient?: Record<string, unknown>;
  resolveChannelRepository?: (channelId: string) => Promise<any>;
} = {}): WorkflowRunnerService {
  return new WorkflowRunnerService(
    {
      getToolClient: () => ({
        hasTool: () => true,
        checkAvailability: async () => true,
        sendPrompt: async () => ({ response: 'done' }),
        ...overrides.toolClient
      })
    } as any,
    {
      resolveChannelRepository: overrides.resolveChannelRepository || (async () => ({}))
    } as any
  );
}

test('WorkflowRunnerService.runTakt: 引数なしはヘルプを返す', async () => {
  const service = createService();

  const response = await service.runTakt({
    text: '',
    channelId: 'C001'
  } as any);

  assert.match(response?.text || '', /使い方/);
  assert.match(response?.blocks?.[0]?.text?.text || '', /TAKT 実行コマンド/);
});

test('WorkflowRunnerService.runTakt: 未登録ツールならエラーを返す', async () => {
  const service = createService({
    toolClient: {
      hasTool: () => false
    }
  });

  const response = await service.runTakt({
    text: 'task',
    channelId: 'C001'
  } as any);

  assert.match(response?.text || '', /takt ツールが登録されていません/);
});

test('WorkflowRunnerService.runTakt: フラグとプロンプトを分離して sendPrompt に渡す', async () => {
  const calls: Array<{ prompt: string; options: any }> = [];
  const service = createService({
    toolClient: {
      sendPrompt: async (prompt: string, options: any) => {
        calls.push({ prompt, options });
        return { response: 'done' };
      }
    },
    resolveChannelRepository: async () => ({
      repository: {
        localPath: 'D:\\repos\\sample'
      }
    })
  });

  const response = await service.runTakt({
    text: '--auto-pr --provider claude --model gpt-4o バグ を 修正',
    channelId: 'C001'
  } as any);

  assert.equal(response?.text, 'done');
  assert.deepEqual(calls, [
    {
      prompt: 'バグ を 修正',
      options: {
        workingDirectory: 'D:\\repos\\sample',
        toolName: 'takt',
        extraArgs: ['--auto-pr', '--provider', 'claude', '--model', 'gpt-4o']
      }
    }
  ]);
});

test('WorkflowRunnerService.runOrcha: 引数なしはヘルプを返す', async () => {
  const service = createService();

  const response = await service.runOrcha({
    text: '',
    channelId: 'C001'
  } as any);

  assert.match(response?.text || '', /使い方/);
  assert.match(response?.blocks?.[0]?.text?.text || '', /orcha 実行コマンド/);
});

test('WorkflowRunnerService.runOrcha: リポジトリ未設定ならエラーを返す', async () => {
  const service = createService({
    resolveChannelRepository: async () => ({})
  });

  const response = await service.runOrcha({
    text: 'status',
    channelId: 'C001'
  } as any);

  assert.match(response?.text || '', /リポジトリがリンクされていません/);
});
