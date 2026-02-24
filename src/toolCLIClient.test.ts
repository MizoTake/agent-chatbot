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

test('ToolCLIClient: claude/codex実行時に標準オプションを自動付与する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);

  try {
    const ensure = (client as any).ensureStandardExecutionOptions.bind(client);
    const claudeTool = {
      name: 'claude',
      command: 'claude',
      args: ['--print', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: true
    };
    const codexTool = {
      name: 'codex',
      command: 'codex',
      args: ['exec', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };

    assert.deepEqual(
      ensure(claudeTool, ['--print', 'hello']),
      ['--dangerously-skip-permissions', '--print', 'hello']
    );
    assert.deepEqual(
      ensure(codexTool, ['exec', 'hello']),
      ['--sandbox', 'danger-full-access', 'exec', 'hello']
    );
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: resumeオプションをツールごとに付与する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);

  try {
    const applyResumeOption = (client as any).applyResumeOption.bind(client);
    const claudeTool = {
      name: 'claude',
      command: 'claude',
      args: ['--print', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: true
    };
    const codexTool = {
      name: 'codex',
      command: 'codex',
      args: ['exec', '--sandbox', 'danger-full-access', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };
    const vibeTool = {
      name: 'vibe-local',
      command: 'vibe-local',
      args: ['--prompt', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };

    assert.deepEqual(
      applyResumeOption(claudeTool, ['--print', 'hello'], true),
      ['--continue', '--print', 'hello']
    );
    assert.deepEqual(
      applyResumeOption(codexTool, ['exec', '--sandbox', 'danger-full-access', 'hello'], true),
      ['--sandbox', 'danger-full-access', 'exec', 'resume', '--last', 'hello']
    );
    assert.deepEqual(
      applyResumeOption(vibeTool, ['--prompt', 'hello'], true),
      ['--resume', '--prompt', 'hello']
    );
  } finally {
    client.cleanup();
  }
});
