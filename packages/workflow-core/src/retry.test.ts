import { describe, expect, it, vi } from "vitest";
import { withRetry, withTimeout } from "./retry.js";

describe("withTimeout", () => {
  it("resolves with fn's value when it settles before the timeout", async () => {
    const result = await withTimeout(async () => "ok", 50);
    expect(result).toBe("ok");
  });

  it("rejects with an explicit timeout error when fn takes too long", async () => {
    const slowFn = (): Promise<string> =>
      new Promise((resolve) => {
        setTimeout(() => resolve("too-late"), 100);
      });

    await expect(withTimeout(slowFn, 10)).rejects.toThrow("Timed out after 10ms");
  });

  it("runs fn directly with no race when ms is undefined", async () => {
    await expect(withTimeout(async () => "direct", undefined)).resolves.toBe("direct");
  });

  it("runs fn directly with no race when ms is zero or negative", async () => {
    await expect(withTimeout(async () => "zero", 0)).resolves.toBe("zero");
    await expect(withTimeout(async () => "negative", -5)).resolves.toBe("negative");
  });

  it("propagates a rejection thrown by fn itself", async () => {
    await expect(
      withTimeout(async () => {
        throw new Error("boom");
      }, 50),
    ).rejects.toThrow("boom");
  });

});

describe("withRetry", () => {
  it("returns fn's result on the first success, without retrying", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("does not retry when no policy is provided (maxAttempts defaults to 1)", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error("single-attempt-failure");
      }),
    ).rejects.toThrow("single-attempt-failure");
    expect(calls).toBe(1);
  });

  it("retries up to maxAttempts and rethrows the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error(`fail-${calls}`);
        },
        { maxAttempts: 3, backoffMs: 1, backoffMultiplier: 1 },
      ),
    ).rejects.toThrow("fail-3");
    expect(calls).toBe(3);
  });

  it("succeeds once fn stops failing, without exhausting all attempts", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw new Error("not yet");
        }
        return "recovered";
      },
      { maxAttempts: 5, backoffMs: 1, backoffMultiplier: 1 },
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("applies exponential backoff delays between attempts", async () => {
    vi.useFakeTimers();
    try {
      const callTimestamps: number[] = [];

      const promise = withRetry(
        async () => {
          callTimestamps.push(Date.now());
          throw new Error("always fails");
        },
        { maxAttempts: 4, backoffMs: 10, backoffMultiplier: 2 },
      );
      const assertion = expect(promise).rejects.toThrow("always fails");

      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(20);
      await vi.advanceTimersByTimeAsync(40);

      await assertion;

      expect(callTimestamps).toHaveLength(4);
      expect(callTimestamps[1]! - callTimestamps[0]!).toBe(10);
      expect(callTimestamps[2]! - callTimestamps[1]!).toBe(20);
      expect(callTimestamps[3]! - callTimestamps[2]!).toBe(40);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait after the final failed attempt", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const promise = withRetry(
        async () => {
          calls++;
          throw new Error("fails");
        },
        { maxAttempts: 2, backoffMs: 1000, backoffMultiplier: 1 },
      );
      const assertion = expect(promise).rejects.toThrow("fails");

      // Only one backoff delay (before the 2nd attempt) should ever be scheduled.
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a maxAttempts of 0 the same as 1 (still runs fn once)", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("fail");
        },
        { maxAttempts: 0 },
      ),
    ).rejects.toThrow("fail");
    expect(calls).toBe(1);
  });
});
