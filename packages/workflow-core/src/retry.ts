import { sleep } from "@datarover/shared";

/**
 * Runs `fn`, racing it against a timeout.
 *
 * When `ms` is `undefined` or is not a strictly positive number, `fn()` is
 * invoked directly and awaited with no race at all (no timer is ever
 * created). Otherwise `fn()` races against a timer that rejects with
 * `Error("Timed out after ${ms}ms")` once `ms` milliseconds elapse. The
 * timer is always cleared before this function settles, whichever side
 * wins the race.
 *
 * @param fn - The asynchronous operation to run.
 * @param ms - Timeout in milliseconds, or `undefined`/`<= 0` to disable it.
 */
export async function withTimeout<T>(fn: () => Promise<T>, ms?: number): Promise<T> {
  if (ms === undefined || ms <= 0) {
    return fn();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Retry behaviour accepted by {@link withRetry}. Structurally compatible
 * with `RetryPolicy` from `@datarover/workflow-types` (whose fields are
 * always present once parsed), so a node's `retryPolicy` can be passed
 * straight through without any adapter.
 */
export interface RetryPolicyLike {
  maxAttempts?: number;
  backoffMs?: number;
  backoffMultiplier?: number;
}

/**
 * Runs `fn`, retrying on failure according to `policy`.
 *
 * - `maxAttempts` (default `1`): total number of attempts, including the
 *   first. A value of `1` (or less) means no retry is ever performed.
 * - Between two attempts, waits
 *   `backoffMs * (backoffMultiplier ** attemptIndex)` milliseconds via
 *   `sleep` from `@datarover/shared`, where `attemptIndex` is `0` for the
 *   delay following the first failed attempt, `1` for the delay following
 *   the second failed attempt, and so on.
 * - If every attempt fails, the error thrown by the last attempt is
 *   rethrown as-is.
 *
 * @param fn - The asynchronous operation to run/retry.
 * @param policy - Optional retry policy; every field defaults as described above.
 */
export async function withRetry<T>(fn: () => Promise<T>, policy?: RetryPolicyLike): Promise<T> {
  const maxAttempts = Math.max(1, policy?.maxAttempts ?? 1);
  const backoffMs = policy?.backoffMs ?? 0;
  const backoffMultiplier = policy?.backoffMultiplier ?? 1;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) {
        break;
      }

      const delayMs = backoffMs * backoffMultiplier ** attempt;
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
