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
