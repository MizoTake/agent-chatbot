import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ToolCLIClient } from './toolCLIClient';

test('ToolCLIClient: {prompt} 繝励Ξ繝ｼ繧ｹ繝帙Ν繝繝ｼ繧堤ｽｮ謠帙＠縺ｦ螳溯｡後〒縺阪ｋ', async () => {
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

test('ToolCLIClient: append prompt when placeholder is missing', async () => {
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

test('ToolCLIClient: 譛ｪ螳夂ｾｩ繝・・繝ｫ謖・ｮ壽凾縺ｫ繧ｨ繝ｩ繝ｼ繧定ｿ斐☆', async () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  try {
    const result = await client.sendPrompt('anything', { toolName: 'unknown-tool' });
    assert.ok(result.error);
    assert.match(result.error, /未対応のツールです/);
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: checkAvailability縺靴LI讀懷・蜿ｯ蜷ｦ繧定ｿ斐☆', async () => {
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

test('ToolCLIClient: ensure -y for vibe-local', () => {
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

test('ToolCLIClient: ensure standard options for claude and codex', () => {
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

test('ToolCLIClient: add resume option per tool', () => {
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

test('ToolCLIClient: PATH から CLI 実体パスを解決する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolcli-path-'));
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;

  try {
    const fileName = process.platform === 'win32' ? 'sample-tool.cmd' : 'sample-tool';
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, 'echo test\n', 'utf8');
    if (process.platform !== 'win32') {
      fs.chmodSync(filePath, 0o755);
    }

    process.env.PATH = tempDir;
    if (process.platform === 'win32') {
      process.env.PATHEXT = '.CMD;.EXE;.BAT';
    }

    const resolved = (client as any).resolveCommandFromPath('sample-tool');
    assert.equal(resolved, filePath);
  } finally {
    process.env.PATH = originalPath;
    if (originalPathExt === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathExt;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    client.cleanup();
  }
});

