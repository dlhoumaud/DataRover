import { describe, expect, it } from "vitest";
import { sleep } from "./sleep.js";

describe("sleep", () => {
  it("resolves after the requested delay has elapsed", async () => {
    const delayMs = 20;
    const start = Date.now();
    await sleep(delayMs);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(delayMs - 5);
  });

  it("resolves with no value", async () => {
    const result = await sleep(20);
    expect(result).toBeUndefined();
  });

  it("waits roughly the requested duration and not far longer", async () => {
    const delayMs = 20;
    const start = Date.now();
    await sleep(delayMs);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(delayMs + 500);
  });
});
