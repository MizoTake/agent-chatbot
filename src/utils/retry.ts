/**
 * リトライ機能のユーティリティ
 */

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: any) => boolean;
  onRetry?: (error: any, attempt: number) => void;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly lastError: any,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * 指数バックオフでリトライを実行
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
    onRetry = () => {}
  } = options;

  let lastError: any;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // 最後の試行またはリトライ不可能なエラーの場合
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw new RetryError(
          `Failed after ${attempt} attempts: ${error instanceof Error ? error.message : String(error)}`,
          lastError,
          attempt
        );
      }

      // リトライコールバック
      onRetry(error, attempt);

      // 次回試行まで待機
      await sleep(delay);

      // 次回の遅延を計算（指数バックオフ）
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  // ここには到達しないはずだが、TypeScriptのため
  throw new RetryError(
    `Failed after ${maxAttempts} attempts`,
    lastError,
    maxAttempts
  );
}

/**
 * 特定のエラーをリトライ可能として判定
 */
export function isRetryableError(error: any): boolean {
  // ネットワークエラー
  if (error.code === 'ECONNREFUSED' || 
      error.code === 'ECONNRESET' || 
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND') {
    return true;
  }

  // HTTPステータスコード
  if (error.statusCode) {
    // 5xx エラーはリトライ可能
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return true;
    }
    // 429 Too Many Requests
    if (error.statusCode === 429) {
      return true;
    }
  }

  // タイムアウト
  if (error.message && error.message.toLowerCase().includes('timeout')) {
    return true;
  }

  // 一時的なGitエラー
  if (error.message && (
    error.message.includes('Could not resolve host') ||
    error.message.includes('Connection timed out') ||
    error.message.includes('Operation timed out')
  )) {
    return true;
  }

  return false;
}

/**
 * スリープ関数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 実行時間制限付きでPromiseを実行
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError?: Error
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(timeoutError || new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}