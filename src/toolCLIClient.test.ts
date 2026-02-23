import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolCLIClient } from './toolCLIClient';

test('ToolCLIClient: {prompt} プレースホルダーを置換して実行できる', async () => {
  const client = new ToolCLIClient(
    {
      echo: {
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.argv[1])', '{prompt}'],
        versionArgs: ['-v']
      }
    },
    'echo',
    5000
  );

  try {
    const result = await client.sendPrompt('hello-tool');
    assert.equal(result.error, undefined);
    assert.equal(result.response, 'hello-tool');
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: プレースホルダー未指定時は末尾にpromptが追加される', async () => {
  const client = new ToolCLIClient(
    {
      echo: {
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.argv[1])'],
        versionArgs: ['-v']
      }
    },
    'echo',
    5000
  );

  try {
    const result = await client.sendPrompt('append-prompt');
    assert.equal(result.error, undefined);
    assert.equal(result.response, 'append-prompt');
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: 未定義ツール指定時にエラーを返す', async () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  try {
    const result = await client.sendPrompt('anything', { toolName: 'unknown-tool' });
    assert.ok(result.error);
    assert.match(result.error, /未対応のツール/);
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: checkAvailabilityがCLI検出可否を返す', async () => {
  const client = new ToolCLIClient(
    {
      ok: {
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.argv[1])', '{prompt}'],
        versionArgs: ['-v']
      },
      ng: {
        command: 'this-command-should-not-exist-xyz',
        args: ['{prompt}'],
        versionArgs: ['--version']
      }
    },
    'ok',
    5000
  );

  try {
    const available = await client.checkAvailability('ok');
    const unavailable = await client.checkAvailability('ng');
    assert.equal(available, true);
    assert.equal(unavailable, false);
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: vibe-local実行時は-yを自動付与する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);

  try {
    const ensure = (client as any).ensureVibeLocalAutoApprove.bind(client);
    const vibeTool = {
      name: 'vibe-local',
      command: 'vibe-local',
      args: ['--prompt', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };
    const otherTool = {
      name: 'codex',
      command: 'codex',
      args: ['exec', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };

    assert.deepEqual(ensure(vibeTool, ['--prompt', 'hello']), ['-y', '--prompt', 'hello']);
    assert.deepEqual(ensure(vibeTool, ['-y', '--prompt', 'hello']), ['-y', '--prompt', 'hello']);
    assert.deepEqual(ensure(otherTool, ['exec', 'hello']), ['exec', 'hello']);
  } finally {
    client.cleanup();
  }
});
