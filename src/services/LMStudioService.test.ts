import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LMStudioService } from './LMStudioService';

type FetchFunction = typeof fetch;

function withFetchStub(stub: FetchFunction, callback: () => Promise<void>): Promise<void> {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = stub;

  return callback().finally(() => {
    globalThis.fetch = previousFetch;
  });
}

test('LMStudioService.fetchModels: モデル一覧を取得して trailing slash を除去する', { concurrency: false }, async () => {
  const calls: string[] = [];
  const service = new LMStudioService();

  await withFetchStub((async (input: string | URL | Request) => {
    calls.push(String(input));
    return {
      ok: true,
      json: async () => ({
        data: [
          { id: 'model-1' },
          { id: 'model-2' },
          { id: '' }
        ]
      })
    } as Response;
  }) as FetchFunction, async () => {
    const actual = await service.fetchModels('http://localhost:1234/');
    assert.deepEqual(actual, ['model-1', 'model-2']);
  });

  assert.deepEqual(calls, ['http://localhost:1234/v1/models']);
});

test('LMStudioService.fetchModels: 非200応答なら空配列を返す', { concurrency: false }, async () => {
  const service = new LMStudioService();

  await withFetchStub((async () => {
    return {
      ok: false
    } as Response;
  }) as FetchFunction, async () => {
    const actual = await service.fetchModels('http://localhost:1234');
    assert.deepEqual(actual, []);
  });
});

test('LMStudioService.fetchModels: fetch 例外時も空配列を返す', { concurrency: false }, async () => {
  const service = new LMStudioService();

  await withFetchStub((async () => {
    throw new Error('network');
  }) as FetchFunction, async () => {
    const actual = await service.fetchModels('http://localhost:1234');
    assert.deepEqual(actual, []);
  });
});

test('LMStudioService.warmupModel: chat completions に POST して true を返す', { concurrency: false }, async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const service = new LMStudioService();

  await withFetchStub((async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return {
      ok: true,
      json: async () => ({ id: 'resp_1' })
    } as Response;
  }) as FetchFunction, async () => {
    const actual = await service.warmupModel('http://localhost:1234/', 'local-model');
    assert.equal(actual, true);
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'http://localhost:1234/v1/chat/completions');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(calls[0].init?.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    model: 'local-model',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1
  });
});

test('LMStudioService.warmupModel: 非200応答なら false を返す', { concurrency: false }, async () => {
  const service = new LMStudioService();

  await withFetchStub((async () => {
    return {
      ok: false,
      status: 503
    } as Response;
  }) as FetchFunction, async () => {
    const actual = await service.warmupModel('http://localhost:1234', 'local-model');
    assert.equal(actual, false);
  });
});

test('LMStudioService.warmupModel: fetch 例外なら false を返す', { concurrency: false }, async () => {
  const service = new LMStudioService();

  await withFetchStub((async () => {
    throw new Error('timeout');
  }) as FetchFunction, async () => {
    const actual = await service.warmupModel('http://localhost:1234', 'local-model');
    assert.equal(actual, false);
  });
});
