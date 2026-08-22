import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getPrismaClient } from "./client.js";
import { releaseProxy, reportProxyErrorAndMaybePurge, reserveAvailableProxy } from "./proxyPool.js";

/**
 * Against a real Postgres (same convention as every other integration test in this monorepo —
 * `apps/api`/`apps/worker`'s e2e suites, `apps/browser-worker`'s real-Chrome tests — never a
 * mocked DB): the one property that actually matters here, `FOR UPDATE SKIP LOCKED` genuinely
 * preventing a double-reservation under real concurrency, cannot be proven any other way.
 */
const prisma = getPrismaClient();

/** Unique per test so parallel test files (or a re-run) never collide on the `[host, port]` unique constraint. */
function uniqueHost(): string {
  return `test-proxy-${randomUUID()}.example`;
}

async function createProxy(overrides: Partial<{ host: string; port: number; errorCount: number; isInUse: boolean }> = {}) {
  return prisma.proxy.create({
    data: {
      host: overrides.host ?? uniqueHost(),
      port: overrides.port ?? 8080,
      errorCount: overrides.errorCount ?? 0,
      isInUse: overrides.isInUse ?? false,
    },
  });
}

const createdIds: string[] = [];

afterEach(async () => {
  // Best-effort: a purge test may have already deleted its own row — deleteMany on a missing id
  // is just a no-op, never an error, so no try/catch needed here either.
  await prisma.proxy.deleteMany({ where: { id: { in: createdIds.splice(0) } } });
});

describe("reserveAvailableProxy", () => {
  it("reserves an available proxy and marks it in use", async () => {
    const proxy = await createProxy();
    createdIds.push(proxy.id);

    const reserved = await reserveAvailableProxy(prisma);

    expect(reserved).toMatchObject({ id: proxy.id, host: proxy.host, port: proxy.port });
    const reloaded = await prisma.proxy.findUniqueOrThrow({ where: { id: proxy.id } });
    expect(reloaded.isInUse).toBe(true);
    expect(reloaded.reservedAt).not.toBeNull();
  });

  it("returns null when nothing is available", async () => {
    const proxy = await createProxy({ isInUse: true });
    createdIds.push(proxy.id);
    // Reserved "just now" — nowhere near the staleness window, so it must NOT be reclaimed.
    await prisma.proxy.update({ where: { id: proxy.id }, data: { reservedAt: new Date() } });

    expect(await reserveAvailableProxy(prisma)).toBeNull();
  });

  it("never lets two concurrent callers reserve the same single proxy (the real point of FOR UPDATE SKIP LOCKED)", async () => {
    const proxy = await createProxy();
    createdIds.push(proxy.id);

    const results = await Promise.all(Array.from({ length: 10 }, () => reserveAvailableProxy(prisma)));

    const successes = results.filter((r) => r !== null);
    expect(successes).toHaveLength(1);
    expect(successes[0]).toMatchObject({ id: proxy.id });
  });

  it("reclaims a reservation abandoned well past the staleness window", async () => {
    const proxy = await createProxy({ isInUse: true });
    createdIds.push(proxy.id);
    await prisma.proxy.update({
      where: { id: proxy.id },
      data: { reservedAt: new Date(Date.now() - 60 * 60_000) }, // 1 hour ago
    });

    const reserved = await reserveAvailableProxy(prisma);
    expect(reserved).toMatchObject({ id: proxy.id });
  });

  it("never reserves a disabled proxy", async () => {
    const proxy = await createProxy();
    createdIds.push(proxy.id);
    await prisma.proxy.update({ where: { id: proxy.id }, data: { status: "disabled" } });

    expect(await reserveAvailableProxy(prisma)).toBeNull();
  });
});

describe("releaseProxy", () => {
  it("marks the proxy available again and clears reservedAt", async () => {
    const proxy = await createProxy({ isInUse: true });
    createdIds.push(proxy.id);
    await prisma.proxy.update({ where: { id: proxy.id }, data: { reservedAt: new Date() } });

    await releaseProxy(prisma, proxy.id);

    const reloaded = await prisma.proxy.findUniqueOrThrow({ where: { id: proxy.id } });
    expect(reloaded.isInUse).toBe(false);
    expect(reloaded.reservedAt).toBeNull();
  });

  it("is a harmless no-op when the proxy was already purged", async () => {
    const proxy = await createProxy();
    // Not pushed to createdIds — deleted below, nothing left to clean up afterward.
    await prisma.proxy.delete({ where: { id: proxy.id } });

    await expect(releaseProxy(prisma, proxy.id)).resolves.toBeUndefined();
  });
});

describe("reportProxyErrorAndMaybePurge", () => {
  it("increments the error count without purging while under the configured threshold", async () => {
    await prisma.proxyPoolConfig.upsert({
      where: { id: "singleton" },
      update: { purgeErrorThreshold: 5 },
      create: { id: "singleton", purgeErrorThreshold: 5 },
    });
    const proxy = await createProxy({ errorCount: 3 });
    createdIds.push(proxy.id);

    const result = await reportProxyErrorAndMaybePurge(prisma, proxy.id);

    expect(result).toEqual({ purged: false });
    const reloaded = await prisma.proxy.findUniqueOrThrow({ where: { id: proxy.id } });
    expect(reloaded.errorCount).toBe(4);
  });

  it("purges (deletes) the proxy the exact moment its error count reaches the threshold, never before", async () => {
    await prisma.proxyPoolConfig.upsert({
      where: { id: "singleton" },
      update: { purgeErrorThreshold: 5 },
      create: { id: "singleton", purgeErrorThreshold: 5 },
    });
    const proxy = await createProxy({ errorCount: 4 });
    createdIds.push(proxy.id);

    const result = await reportProxyErrorAndMaybePurge(prisma, proxy.id);

    expect(result).toEqual({ purged: true });
    expect(await prisma.proxy.findUnique({ where: { id: proxy.id } })).toBeNull();
  });
});
