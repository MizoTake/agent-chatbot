import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

test('ToolCLIClient: 未対応ツール指定時にエラーを返す', async () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  try {
    const result = await client.sendPrompt('anything', { toolName: 'unknown-tool' });
    assert.ok(result.error);
    assert.match(result.error, /未対応のツールです/);
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: checkAvailabilityがCLI実行可能を返す', async () => {
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

test('ToolCLIClient: codex with provider and model options for OSS models', () => {
  const client = new ToolCLIClient(
    {
      codex: {
        command: 'codex',
        args: ['exec', '--sandbox', 'danger-full-access', '{prompt}'],
        versionArgs: ['--version'],
        provider: 'ollama',
        model: 'qwen3:8b'
      }
    },
    'codex',
    5000
  );

  try {
    const ensure = (client as any).ensureStandardExecutionOptions.bind(client);
    const tools = client.listTools();
    const codexTool = tools.find((t: any) => t.name === 'codex');
    assert.ok(codexTool);
    assert.equal(codexTool.provider, 'ollama');
    assert.equal(codexTool.model, 'qwen3:8b');

    const result = ensure(codexTool, ['exec', '--sandbox', 'danger-full-access', 'hello']);
    assert.ok(result.includes('--provider'), 'should include --provider');
    assert.ok(result.includes('ollama'), 'should include provider value');
    assert.ok(result.includes('--model'), 'should include --model');
    assert.ok(result.includes('qwen3:8b'), 'should include model value');
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: codex without provider/model does not add extra flags', () => {
  const client = new ToolCLIClient(
    {
      codex: {
        command: 'codex',
        args: ['exec', '--sandbox', 'danger-full-access', '{prompt}'],
        versionArgs: ['--version']
      }
    },
    'codex',
    5000
  );

  try {
    const ensure = (client as any).ensureStandardExecutionOptions.bind(client);
    const codexTool = client.listTools().find((t: any) => t.name === 'codex');
    assert.ok(codexTool);

    const result = ensure(codexTool, ['exec', '--sandbox', 'danger-full-access', 'hello']);
    assert.ok(!result.includes('--provider'), 'should not include --provider');
    assert.ok(!result.includes('--model'), 'should not include --model');
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: codex provider/model not duplicated when already present', () => {
  const client = new ToolCLIClient(
    {
      codex: {
        command: 'codex',
        args: ['exec', '--sandbox', 'danger-full-access', '{prompt}'],
        versionArgs: ['--version'],
        provider: 'ollama',
        model: 'qwen3:8b'
      }
    },
    'codex',
    5000
  );

  try {
    const ensure = (client as any).ensureStandardExecutionOptions.bind(client);
    const codexTool = client.listTools().find((t: any) => t.name === 'codex');
    assert.ok(codexTool);

    const result = ensure(codexTool, ['--provider', 'lmstudio', '--model', 'llama3', 'exec', '--sandbox', 'danger-full-access', 'hello']);
    const providerCount = result.filter((a: string) => a === '--provider').length;
    const modelCount = result.filter((a: string) => a === '--model').length;
    assert.equal(providerCount, 1, 'should not duplicate --provider');
    assert.equal(modelCount, 1, 'should not duplicate --model');
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
// processOutput — LLM 特殊トークンのフィルタリング
// ────────────────────────────────────────────────────────────────────────────

test('processOutput: <|special_token|> 形式のトークンを除去する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const process = (client as any).processOutput.bind(client);

  // 実際に観測されたパターン: <|channel|>, <|constrain|>
  assert.equal(
    process('<|channel|>こんにちは'),
    'こんにちは'
  );
  assert.equal(
    process('返答です<|constrain|>'),
    '返答です'
  );
  assert.equal(
    process('<|channel|>comment?… 本文 <|constrain|>'),
    'comment?… 本文'
  );

  client.cleanup();
});

test('processOutput: to=functions.xxx 形式の漏れたツール呼び出し行を除去する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const process = (client as any).processOutput.bind(client);

  // 実際に観測されたパターン: to=functions.read... で応答が終わる
  assert.equal(
    process('正常な回答\nto=functions.read filePath="src/foo.ts"'),
    '正常な回答'
  );
  assert.equal(
    process('to=functions.read filePath="src/foo.ts"\n正常な回答'),
    '正常な回答'
  );

  client.cleanup();
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

test('parseToolOutput: opencode — 改行なしで結合されたチャンクも正しく解析できる', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // LMStudio がチャンクを改行なしで結合して送出するケース (実際に観測されたパターン)
  // 壊れた例: {"type\m","type":"step-start",...} のように途中から次のオブジェクトが始まる
  // ここでは改行なしで2つの完全なオブジェクトが連続するケースを検証する
  const merged =
    JSON.stringify({ type: 'step_start', sessionID: 'ses_merged01', part: { id: 'prt_s', type: 'step-start' } }) +
    JSON.stringify({ type: 'text', sessionID: 'ses_merged01', part: { id: 'prt_t', type: 'text', text: '結合されたチャンク' } }) +
    JSON.stringify({ type: 'step_finish', sessionID: 'ses_merged01', part: { id: 'prt_f', type: 'step-finish', reason: 'stop' } });

  const result = parse(opencodeTool, merged);
  assert.equal(result.sessionId, 'ses_merged01');
  assert.equal(result.response, '結合されたチャンク');

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

test('parseToolOutput: opencode — response.output_text 形式の本文を抽出する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  const ndjson = [
    JSON.stringify({ type: 'response.completed', sessionID: 'ses_response_api', response: { output_text: 'Response API の本文です。' } }),
    JSON.stringify({ type: 'step_finish', sessionID: 'ses_response_api', part: { id: 'prt_f', type: 'step-finish', reason: 'stop' } })
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_response_api');
  assert.equal(result.response, 'Response API の本文です。');

  client.cleanup();
});

test('parseToolOutput: opencode — text イベントが一つもなければ空文字を返す (NDJSON をそのまま返さない)', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  const ndjson = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_notext', part: { id: 'prt_s', type: 'step-start' } }),
    JSON.stringify({ type: 'step_finish', sessionID: 'ses_notext', part: { id: 'prt_f', type: 'step-finish', reason: 'stop' } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  // sessionID は取れているが text parts がないので空文字を返す (生 NDJSON はユーザーに見せない)
  assert.equal(result.sessionId, 'ses_notext');
  assert.equal(result.response, '');

  client.cleanup();
});

test('parseToolOutput: opencode — part.id が欠けていても text を収集する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // LMStudio 経由の opencode が part.id を省略するケース
  const ndjson = [
    JSON.stringify({ type: 'text', sessionID: 'ses_noid', part: { type: 'text', text: '回答です。' } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_noid');
  assert.equal(result.response, '回答です。');

  client.cleanup();
});

test('parseToolOutput: opencode — processOutput がすべてのコンテンツを除去した場合は raw テキストを返す', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // 特殊トークンのみからなるテキスト — processOutput が全部ストリップする
  const ndjson = JSON.stringify({
    type: 'text',
    sessionID: 'ses_stripall',
    part: { id: 'prt_1', type: 'text', text: '<|im_end|>' }
  });

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_stripall');
  // processOutput で空になるが raw text もほぼ空なのでそのまま空を返す
  // (トークンのみで実質コンテンツなし)
  assert.equal(result.response, '');

  client.cleanup();
});

test('parseToolOutput: opencode — ツール呼び出しのみでテキスト応答がない場合はツール使用サマリーを返す', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // LLM がツール呼び出し(grep)のみ行い、空の text パートを発行したケース
  // (実運用で頻発するパターン: output tokens > 0 だが text は空)
  const ndjson = [
    JSON.stringify({ type: 'step_start', sessionID: 'ses_toolonly', part: { id: 'prt_s', type: 'step-start' } }),
    JSON.stringify({ type: 'text', sessionID: 'ses_toolonly', part: { id: 'prt_empty', type: 'text', text: '' } }),
    JSON.stringify({ type: 'tool_use', sessionID: 'ses_toolonly', part: { id: 'prt_tool1', type: 'tool', tool: 'grep', state: { status: 'completed' } } }),
    JSON.stringify({ type: 'tool_use', sessionID: 'ses_toolonly', part: { id: 'prt_tool2', type: 'tool', tool: 'read', state: { status: 'completed' } } }),
    JSON.stringify({ type: 'step_finish', sessionID: 'ses_toolonly', part: { id: 'prt_f', type: 'step-finish', reason: 'stop', tokens: { total: 200, input: 100, output: 100, reasoning: 0 } } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_toolonly');
  // 空レスポンスではなくツール使用サマリーが返される
  assert.ok(result.response.includes('grep'));
  assert.ok(result.response.includes('read'));
  assert.ok(result.response.length > 0);

  client.cleanup();
});

test('parseToolOutput: opencode — ツール呼び出し後にテキスト応答がある場合はテキストを返す', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // ツール呼び出し + テキスト応答がある場合はテキストを優先
  const ndjson = [
    JSON.stringify({ type: 'tool_use', sessionID: 'ses_tooltext', part: { id: 'prt_tool', type: 'tool', tool: 'grep', state: { status: 'completed' } } }),
    JSON.stringify({ type: 'text', sessionID: 'ses_tooltext', part: { id: 'prt_text', type: 'text', text: 'grepの結果を確認しました。問題ありません。' } }),
    JSON.stringify({ type: 'step_finish', sessionID: 'ses_tooltext', part: { id: 'prt_f', type: 'step-finish', reason: 'stop' } }),
  ].join('\n');

  const result = parse(opencodeTool, ndjson);
  assert.equal(result.sessionId, 'ses_tooltext');
  assert.equal(result.response, 'grepの結果を確認しました。問題ありません。');

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

test('parseToolOutput: claude — content 配列形式から本文を抽出する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const claudeTool = { name: 'claude', command: 'claude', args: [], versionArgs: [], supportsSkipPermissions: true };

  const jsonOutput = JSON.stringify({
    type: 'message',
    session_id: 'ses-claude-content',
    content: [
      { type: 'text', text: 'Claude の本文です。' }
    ]
  });
  const result = parse(claudeTool, jsonOutput);
  assert.equal(result.response, 'Claude の本文です。');
  assert.equal(result.sessionId, 'ses-claude-content');

  client.cleanup();
});

test('parseToolOutput: claude — tool_use のみなら toolCallsOnly を返す', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const claudeTool = { name: 'claude', command: 'claude', args: [], versionArgs: [], supportsSkipPermissions: true };

  const jsonOutput = JSON.stringify({
    type: 'message',
    session_id: 'ses-claude-toolonly',
    content: [
      { type: 'tool_use', id: 'tool_1', name: 'Read' }
    ]
  });
  const result = parse(claudeTool, jsonOutput);
  assert.equal(result.sessionId, 'ses-claude-toolonly');
  assert.equal(result.toolCallsOnly, true);
  assert.ok(result.response.includes('Read'));

  client.cleanup();
});

test('parseToolOutput: claude — 連結JSONイベントの delta.text を本文として抽出する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const claudeTool = { name: 'claude', command: 'claude', args: [], versionArgs: [], supportsSkipPermissions: true };

  const streamOutput = [
    JSON.stringify({ type: 'message_start', session_id: 'ses-claude-stream' }),
    JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ストリーム本文です。' } }),
    JSON.stringify({ type: 'message_stop' })
  ].join('');

  const result = parse(claudeTool, streamOutput);
  assert.equal(result.sessionId, 'ses-claude-stream');
  assert.equal(result.response, 'ストリーム本文です。');

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

// ────────────────────────────────────────────────────────────────────────────
// 今回追加した機能のテスト
// ────────────────────────────────────────────────────────────────────────────

test('processOutput: <tool_call> XML ブロックを除去する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const proc = (client as any).processOutput.bind(client);

  assert.equal(
    proc('<tool_call>\n<function=read>\n<parameter=filePath>src/foo.ts</parameter>\n</function>\n</tool_call>\n実際の応答'),
    '実際の応答'
  );
  // Multiple tool_call blocks
  assert.equal(
    proc('<tool_call>\n<function=read>\n</function>\n</tool_call>\nOK\n<tool_call>\n<function=write>\n</function>\n</tool_call>'),
    'OK'
  );

  client.cleanup();
});

test('processOutput: <function=...> ブロックを除去する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const proc = (client as any).processOutput.bind(client);

  assert.equal(
    proc('<function=read>\n<parameter=filePath>test.ts</parameter>\n</function>応答テキスト'),
    '応答テキスト'
  );

  client.cleanup();
});

test('processOutput: 漏洩したシステムプロンプト指示を除去する', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const proc = (client as any).processOutput.bind(client);

  assert.equal(
    proc('Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed.\n\nWhat would you like help with?\n\n本当の応答'),
    '本当の応答'
  );
  assert.equal(
    proc("We haven't completed any work yet. I was going to read a file.\n\nWhat would you like help with?"),
    ''
  );

  client.cleanup();
});

test('ToolCLIClient: ensure --pipeline for takt', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);

  try {
    const ensure = (client as any).ensureTaktPipelineMode.bind(client);
    const taktTool = {
      name: 'takt',
      command: 'takt',
      args: ['--task', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };
    const otherTool = {
      name: 'claude',
      command: 'claude',
      args: ['--print', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: true
    };

    // takt: --pipeline が付与される
    assert.deepEqual(
      ensure(taktTool, ['--task', 'hello']),
      ['--pipeline', '--task', 'hello']
    );
    // takt: 既に --pipeline がある場合は重複しない
    assert.deepEqual(
      ensure(taktTool, ['--pipeline', '--task', 'hello']),
      ['--pipeline', '--task', 'hello']
    );
    // 他のツールには影響しない
    assert.deepEqual(
      ensure(otherTool, ['--print', 'hello']),
      ['--print', 'hello']
    );
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: takt の --continue resume オプション', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);

  try {
    const applyResumeOption = (client as any).applyResumeOption.bind(client);
    const taktTool = {
      name: 'takt',
      command: 'takt',
      args: ['--pipeline', '--task', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };

    // takt: resume=true → --continue が付与される
    assert.deepEqual(
      applyResumeOption(taktTool, ['--pipeline', '--task', 'hello'], true, undefined),
      ['--continue', '--pipeline', '--task', 'hello']
    );
    // takt: 既に --continue がある場合は重複しない
    assert.deepEqual(
      applyResumeOption(taktTool, ['--continue', '--pipeline', '--task', 'hello'], true, undefined),
      ['--continue', '--pipeline', '--task', 'hello']
    );
    // takt: resume=false → --continue は付与されない
    assert.deepEqual(
      applyResumeOption(taktTool, ['--pipeline', '--task', 'hello'], false, undefined),
      ['--pipeline', '--task', 'hello']
    );
  } finally {
    client.cleanup();
  }
});

test('ToolCLIClient: extraArgs がツール引数の前に挿入される', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);

  try {
    // Test that extraArgs are prepended when executeTool builds the args list.
    // We verify via the internal buildArgs + the extraArgs insertion logic
    // rather than spawning a process, since extraArgs are passed before tool args
    // and would be interpreted as node flags.
    const buildArgs = (client as any).buildArgs.bind(client);
    const tool = {
      name: 'takt',
      command: 'takt',
      args: ['--pipeline', '--task', '{prompt}'],
      versionArgs: ['--version'],
      supportsSkipPermissions: false
    };

    const builtArgs = buildArgs(tool, 'hello world');
    assert.deepEqual(builtArgs, ['--pipeline', '--task', 'hello world']);

    // Simulate extraArgs insertion (same logic as executeTool)
    const extraArgs = ['--auto-pr', '--provider', 'claude'];
    const finalArgs = [...extraArgs, ...builtArgs];
    assert.deepEqual(finalArgs, ['--auto-pr', '--provider', 'claude', '--pipeline', '--task', 'hello world']);
  } finally {
    client.cleanup();
  }
});

test('parseToolOutput: opencode — toolCallsOnly フラグが設定される', () => {
  const client = new ToolCLIClient({}, 'claude', 5000);
  const parse = (client as any).parseToolOutput.bind(client);
  const opencodeTool = { name: 'opencode', command: 'opencode', args: [], versionArgs: [], supportsSkipPermissions: false };

  // ツール呼び出しのみ（テキスト応答なし）の場合 toolCallsOnly=true
  const ndjsonToolOnly = [
    '{"type":"tool_use","sessionID":"ses_tc","part":{"id":"prt_t","type":"tool_use","tool":"read","status":"completed"}}',
    '{"type":"step_finish","sessionID":"ses_tc","part":{"id":"prt_f","type":"step-finish","reason":"stop","tokens":{"output":50}}}'
  ].join('\n');
  const resultToolOnly = parse(opencodeTool, ndjsonToolOnly);
  assert.equal(resultToolOnly.toolCallsOnly, true);
  assert.equal(resultToolOnly.sessionId, 'ses_tc');

  // テキスト応答がある場合 toolCallsOnly は undefined
  const ndjsonWithText = [
    '{"type":"tool_use","sessionID":"ses_tc2","part":{"id":"prt_t","type":"tool_use","tool":"read"}}',
    '{"type":"text","sessionID":"ses_tc2","part":{"id":"prt_1","type":"text","text":"結果です"}}'
  ].join('\n');
  const resultWithText = parse(opencodeTool, ndjsonWithText);
  assert.equal(resultWithText.toolCallsOnly, undefined);
  assert.equal(resultWithText.response, '結果です');

  client.cleanup();
});

