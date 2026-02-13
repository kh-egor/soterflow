/**
 * @module channels/retry
 * Shared retry utility with exponential backoff for all channel connectors.
 */

export const DEFAULT_MAX_RETRIES = 3;

/** Sleep helper */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxRetries?: number;
  /** Function to determine if an error is retryable (default: server errors + network resets) */
  isRetryable?: (err: any) => boolean;
  /** Function to compute wait time in ms for a given attempt and error (default: exponential backoff) */
  getWaitMs?: (attempt: number, err: any) => number;
}

/** Default retryable check: 5xx, 429, ECONNRESET */
export function defaultIsRetryable(err: any): boolean {
  const status = err?.status ?? err?.response?.status ?? err?.statusCode;
  if (status === 429) {
    return true;
  }
  if (status >= 500) {
    return true;
  }
  if (err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT") {
    return true;
  }
  return false;
}

/** Default backoff: 1s, 2s, 4s... capped at 120s. Respects Retry-After and x-ratelimit-reset headers. */
export function defaultGetWaitMs(attempt: number, err: any): number {
  // Check Retry-After header (Slack-style, seconds)
  const retryAfter =
    err?.response?.headers?.get?.("retry-after") ??
    err?.response?.headers?.["retry-after"] ??
    err?.headers?.["retry-after"];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!isNaN(seconds) && seconds > 0) {
      return Math.min(seconds * 1000 + 500, 120_000);
    }
  }

  // Check x-ratelimit-reset (GitHub-style, unix timestamp)
  const resetHeader =
    err?.response?.headers?.get?.("x-ratelimit-reset") ??
    err?.response?.headers?.["x-ratelimit-reset"];
  if (resetHeader) {
    const waitMs = Math.max(0, Number(resetHeader) * 1000 - Date.now()) + 1000;
    return Math.min(waitMs, 120_000);
  }

  // Exponential backoff
  return Math.min(1000 * 2 ** attempt, 120_000);
}

/**
 * Retry a function with exponential backoff.
 * @param fn - Async function to retry
 * @param options - Retry configuration
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const isRetryable = options?.isRetryable ?? defaultIsRetryable;
  const getWaitMs = options?.getWaitMs ?? defaultGetWaitMs;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (!isRetryable(err) || attempt === maxRetries - 1) {
        throw err;
      }
      await sleep(getWaitMs(attempt, err));
    }
  }
  throw new Error("withRetry: unreachable");
}
