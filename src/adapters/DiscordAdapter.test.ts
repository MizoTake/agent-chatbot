import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordAdapter } from './DiscordAdapter';

test('DiscordAdapter: embed の件数と説明文長を Discord 制約内に収める', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const convertBlocksToEmbeds = (adapter as any).convertBlocksToEmbeds.bind(adapter);

  const blocks = Array.from({ length: 12 }, () => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: 'a'.repeat(5000),
    },
  }));

  const embeds = convertBlocksToEmbeds(blocks);
  assert.equal(embeds.length, 10);
  assert.ok(embeds.every((embed: any) => embed.description.length <= 4096));
});

test('DiscordAdapter: embed がない場合は content を 2000 文字に切り詰める', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const buildMessagePayload = (adapter as any).buildMessagePayload.bind(adapter);

  const payload = buildMessagePayload({ text: 'b'.repeat(2500) });
  assert.equal(payload.content.length, 2000);
});

test('DiscordAdapter: embed がある場合は embed を優先して送信する', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const buildMessagePayload = (adapter as any).buildMessagePayload.bind(adapter);

  const payload = buildMessagePayload({
    text: 'short',
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'c'.repeat(5000),
      },
    }],
  });

  assert.ok(payload.embeds);
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].description.length, 4096);
  assert.equal(payload.content, undefined);
});

// ────────────────────────────────────────────────────────────────────────────
// splitText — 長文メッセージ分割
// ────────────────────────────────────────────────────────────────────────────

test('DiscordAdapter.splitText: 2000文字以内はそのまま1チャンクで返す', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const split = (adapter as any).splitText.bind(adapter);

  const short = 'Hello, world!';
  assert.deepEqual(split(short), [short]);

  const exact = 'x'.repeat(2000);
  assert.deepEqual(split(exact), [exact]);
});

test('DiscordAdapter.splitText: 長文を複数チャンクに分割する', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const split = (adapter as any).splitText.bind(adapter);

  const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'a'.repeat(50)}`).join('\n');
  const chunks = split(lines);

  assert.ok(chunks.length > 1, 'Should produce multiple chunks');
  chunks.forEach((chunk: string, i: number) => {
    assert.ok(chunk.length <= 2000, `Chunk ${i} exceeds 2000 chars: ${chunk.length}`);
  });
  // Rejoined text should equal original (no data loss)
  assert.equal(chunks.join(''), lines);
});

test('DiscordAdapter.splitText: コードブロックを正しく閉じて再開する', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const split = (adapter as any).splitText.bind(adapter);

  // Create a long code block that forces splitting
  const codeLines = Array.from({ length: 80 }, (_, i) => `  console.log("line ${i}");`).join('\n');
  const text = '```javascript\n' + codeLines + '\n```';
  const chunks = split(text);

  assert.ok(chunks.length > 1, 'Should produce multiple chunks');

  // Each chunk with an open ``` should have a closing ```
  chunks.forEach((chunk: string, i: number) => {
    const count = (chunk.match(/```/g) || []).length;
    assert.equal(count % 2, 0, `Chunk ${i} has unbalanced code fence (count: ${count})`);
  });
});

test('DiscordAdapter.splitText: 空白行やコードブロック境界で優先的に分割する', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const split = (adapter as any).splitText.bind(adapter);

  // Content with a natural split point (blank line) near the middle
  const part1 = 'A'.repeat(1000);
  const part2 = 'B'.repeat(1000);
  const text = part1 + '\n\n' + part2;
  const chunks = split(text);

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].startsWith('A'));
  assert.ok(chunks[1].trimStart().startsWith('B'));
});

test('DiscordAdapter.extractResponseText: blocks からテキストを抽出する', () => {
  const adapter = new DiscordAdapter('dummy-token');
  const extract = (adapter as any).extractResponseText.bind(adapter);

  const response = {
    text: 'fallback',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: 'Block 1' } },
      { type: 'section', text: { type: 'mrkdwn', text: 'Block 2' } },
    ],
  };
  assert.equal(extract(response), 'Block 1\n\nBlock 2');

  // blocks が空なら text にフォールバック
  assert.equal(extract({ text: 'fallback', blocks: [] }), 'fallback');
  assert.equal(extract({ text: 'fallback' }), 'fallback');
});
