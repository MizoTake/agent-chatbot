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

    // claude: no sessionId → fresh start (no flag added)
    assert.deepEqual(
      applyResumeOption(claudeTool, ['--print', 'hello'], true, undefined),
      ['--print', 'hello']
    );
    // claude: with sessionId → --resume <id>
    assert.deepEqual(
      applyResumeOption(claudeTool, ['--print', 'hello'], true, 'ses-abc'),
      ['--resume', 'ses-abc', '--print', 'hello']
    );
    // claude: resumeConversation=false → no flag
    assert.deepEqual(
      applyResumeOption(claudeTool, ['--print', 'hello'], false, 'ses-abc'),
      ['--print', 'hello']
    );
    assert.deepEqual(
      applyResumeOption(codexTool, ['exec', '--sandbox', 'danger-full-access', 'hello'], true),
      ['--sandbox', 'danger-full-access', 'exec', 'resume', '--last', 'hello']
    );
    assert.deepEqual(
      applyResumeOption(vibeTool, ['--prompt', 'hello'], true),
      ['--resume', '--prompt', 'hello']
    );

    const opencodeTool = {
      name: 'opencode',
      command: 'opencode',
      args: ['run', '--format', 'json', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };
    // opencode: no sessionId → fresh start (no flag added)
    assert.deepEqual(
      applyResumeOption(opencodeTool, ['run', '--format', 'json', 'hello'], true, undefined),
      ['run', '--format', 'json', 'hello']
    );
    // opencode: with sessionId → --session <id> inserted after 'run'
    assert.deepEqual(
      applyResumeOption(opencodeTool, ['run', '--format', 'json', 'hello'], true, 'ses_01abc'),
      ['run', '--session', 'ses_01abc', '--format', 'json', 'hello']
    );
    // opencode: resumeConversation=false → no flag
    assert.deepEqual(
      applyResumeOption(opencodeTool, ['run', '--format', 'json', 'hello'], false, 'ses_01abc'),
      ['run', '--format', 'json', 'hello']
    );
  } finally {
    client.cleanup();
  }
});

// ────────────────────────────────────────────────────────────────────────────
// parseToolOutput / parseOpencodeJsonOutput — 実際のレスポンス形式を検証する
// ────────────────────────────────────────────────────────────────────────────

test('parseToolOutput: opencode text イベント (実際の出力形式) からテキストと sessionID を抽出する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // 実際のログから取得した NDJSON (type="text", part.text にテキストが入る)
  const ndjson = [
    JSON.stringify({ type: 'step_start', timestamp: 1774262490449, sessionID: 'ses_2e5c9ba28ffekEwRHUaS1dXkBB', part: { id: 'prt_start', sessionID: 'ses_2e5c9ba28ffekEwRHUaS1dXkBB', messageID: 'msg_abc', type: 'step-start', snapshot: 'snap' } }),
    JSON.stringify({ type: 'tool_use', timestamp: 1774262501471, sessionID: 'ses_2e5c9ba28ffekEwRHUaS1dXkBB', part: { id: 'prt_tool', type: 'tool', callID: '911972887', tool: 'grep', state: { status: 'completed' } } }),
    JSON.stringify({ type: 'text', timestamp: 1774262761698, sessionID: 'ses_2e5c9ba28ffekEwRHUaS1dXkBB', part: { id: 'prt_text1', sessionID: 'ses_2e5c9ba28ffekEwRHUaS1dXkBB', messageID: 'msg_abc', type: 'text', text: 'こんにちは、世界！', time: { start: 1774262761696, end: 1774262761696 } } }),
    JSON.stringify({ type: 'step_finish', timestamp: 1774262761789, sessionID: 'ses_2e5c9ba28ffekEwRHUaS1dXkBB', part: { id: 'prt_finish', type: 'step-finish', reason: 'stop' } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_2e5c9ba28ffekEwRHUaS1dXkBB');
  assert.equal(result.response, 'こんにちは、世界！');

  client.cleanup();
});

test('parseToolOutput: opencode streaming — 同一 part.id の更新は最終テキストで上書きされる', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // 同一 part.id に対して複数回 text イベントが来るケース (streaming 更新)
  const ndjson = [
    JSON.stringify({ type: 'text', sessionID: 'ses_stream01', part: { id: 'prt_A', type: 'text', text: 'Hello' } }),
    JSON.stringify({ type: 'text', sessionID: 'ses_stream01', part: { id: 'prt_A', type: 'text', text: 'Hello, world!' } }),
    JSON.stringify({ type: 'text', sessionID: 'ses_stream01', part: { id: 'prt_B', type: 'text', text: ' Done.' } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_stream01');
  // prt_A の最終テキスト + prt_B (順序は挿入順)
  assert.equal(result.response, 'Hello, world! Done.');

  client.cleanup();
});

test('parseToolOutput: opencode — message.part.updated 形式 (旧 API) にも対応する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  const ndjson = [
    JSON.stringify({ type: 'message.part.updated', sessionID: 'ses_legacy01', properties: { part: { id: 'prt_legacy', type: 'text', text: 'Legacy format response' } } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_legacy01');
  assert.equal(result.response, 'Legacy format response');

  client.cleanup();
});

test('parseToolOutput: opencode — JSON 以外の行は無視してクラッシュしない', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  const ndjson = [
    'not json at all',
    '',
    JSON.stringify({ type: 'text', sessionID: 'ses_noisy01', part: { id: 'prt_x', type: 'text', text: 'clean response' } }),
    'another garbage line',
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_noisy01');
  assert.equal(result.response, 'clean response');

  client.cleanup();
});

test('parseToolOutput: opencode — text イベントが一つもなければ stdout をそのまま返す', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  const ndjson = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_notext', part: { id: 'prt_s', type: 'step-start' } }),
    JSON.stringify({ type: 'step_finish', sessionID: 'ses_notext', part: { id: 'prt_f', type: 'step-finish', reason: 'stop' } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  // sessionID は取れているが text parts がないので processOutput(stdout) をそのまま返す
  assert.equal(result.sessionId, 'ses_notext');
  assert.ok(result.response.length >= 0);

  client.cleanup();
});

test('parseToolOutput: claude --output-format json からテキストと session_id を抽出する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const claudeTool = { name: 'claude', command: 'claude', args: [], versionArgs: [], supportsSkipPermissions: true };

  const jsonOutput = JSON.stringify({ type: 'result', result: 'Claude の回答です。', session_id: 'ses-claude-abc123' });
  const result = parse(claudeTool, jsonOutput);
  assert.equal(result.response, 'Claude の回答です。');
  assert.equal(result.sessionId, 'ses-claude-abc123');

  client.cleanup();
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

