import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, withTimeout, isRetryableError, RetryError } from './retry';

// ─── withRetry ────────────────────────────────────────────────────────────────

test('withRetry: 成功時はそのまま結果を返す', async () => {
  const result = await withRetry(() => Promise.resolve(42));
  assert.equal(result, 42);
});

test('withRetry: 一時失敗後に成功した場合は結果を返す', async () => {
  let calls = 0;
  const result = await withRetry(
    () => {
      calls++;
      if (calls < 3) throw new Error('temporary');
      return Promise.resolve('ok');
    },
    { maxAttempts: 3, initialDelay: 0 }
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetry: maxAttempts 超過時は RetryError をスローする', async () => {
  await assert.rejects(
    () =>
      withRetry(() => Promise.reject(new Error('always fails')), {
        maxAttempts: 2,
        initialDelay: 0,
      }),
    (err: any) => {
      assert.equal(err instanceof RetryError, true);
      assert.equal(err.name, 'RetryError');
      assert.ok(err.attempts >= 2);
      return true;
    }
  );
});

test('withRetry: shouldRetry が false を返した場合は即座にスローする', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        () => {
          calls++;
          throw new Error('non-retryable');
        },
        {
          maxAttempts: 5,
          initialDelay: 0,
          shouldRetry: () => false,
        }
      ),
    RetryError
  );
  assert.equal(calls, 1, 'should only be called once');
});

test('withRetry: onRetry コールバックはリトライごとに呼ばれる', async () => {
  const retryCalls: number[] = [];
  await assert.rejects(
    () =>
      withRetry(() => Promise.reject(new Error('fail')), {
        maxAttempts: 3,
        initialDelay: 0,
        onRetry: (_err, attempt) => retryCalls.push(attempt),
      }),
    RetryError
  );
  // maxAttempts=3 → 2回リトライ（1,2回目失敗後）
  assert.deepEqual(retryCalls, [1, 2]);
});

// ─── withTimeout ──────────────────────────────────────────────────────────────

test('withTimeout: タイムアウト前に完了した場合は結果を返す', async () => {
  const result = await withTimeout(Promise.resolve('done'), 1000);
  assert.equal(result, 'done');
});

test('withTimeout: タイムアウト超過時はエラーをスローする', async () => {
  const neverResolves = new Promise<never>(() => {});
  await assert.rejects(
    () => withTimeout(neverResolves, 10),
    /timed out/i
  );
});

test('withTimeout: カスタムエラーを指定できる', async () => {
  const neverResolves = new Promise<never>(() => {});
  const customError = new Error('custom timeout message');
  await assert.rejects(
    () => withTimeout(neverResolves, 10, customError),
    (err: any) => {
      assert.equal(err.message, 'custom timeout message');
      return true;
    }
  );
});

// ─── isRetryableError ────────────────────────────────────────────────────────

test('isRetryableError: ネットワークエラーコードはリトライ可能', () => {
  assert.equal(isRetryableError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryableError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isRetryableError({ code: 'ENOTFOUND' }), true);
});

test('isRetryableError: 5xx ステータスはリトライ可能', () => {
  assert.equal(isRetryableError({ statusCode: 500 }), true);
  assert.equal(isRetryableError({ statusCode: 503 }), true);
});

test('isRetryableError: 429 Too Many Requests はリトライ可能', () => {
  assert.equal(isRetryableError({ statusCode: 429 }), true);
});

test('isRetryableError: timeout メッセージはリトライ可能', () => {
  assert.equal(isRetryableError({ message: 'Operation timed out' }), true);
  assert.equal(isRetryableError({ message: 'Connection timed out' }), true);
});

test('isRetryableError: 4xx (429以外) はリトライ不可', () => {
  assert.equal(isRetryableError({ statusCode: 400 }), false);
  assert.equal(isRetryableError({ statusCode: 404 }), false);
  assert.equal(isRetryableError({ statusCode: 401 }), false);
});

test('isRetryableError: 一般的なエラーはリトライ不可', () => {
  assert.equal(isRetryableError(new Error('something went wrong')), false);
  assert.equal(isRetryableError({ code: 'ENOENT' }), false);
});
