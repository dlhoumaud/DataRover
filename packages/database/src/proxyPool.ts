import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * How long a reservation is honored before it's treated as abandoned and made available again,
 * even if nothing ever explicitly released it — e.g. a worker process that died mid-execution.
 * Deliberately a hardcoded fallback rather than a separate cleanup job/heartbeat mechanism: the
 * next `reserveAvailableProxy` call is what notices and reclaims a stale reservation, nothing
 * needs to run proactively in the background for this.
 */
const RESERVATION_STALE_MINUTES = 15;

export interface ReservedProxy {
  id: string;
  host: string;
  port: number;
}

/**
 * Atomically picks one available proxy from the global pool and marks it reserved, or returns
 * `null` if none is available right now. This is the one place in the whole feature where
 * correctness under concurrency actually matters: `apps/worker` runs with `concurrency: 5` by
 * default and can be scaled to multiple replicas (`docker compose --scale worker=3`), so two
 * workflow executions can call this at the same instant. A plain `findFirst` followed by a
 * separate `update` is NOT atomic — both calls could read the same "available" row before either
 * writes, reserving the same proxy twice. `FOR UPDATE SKIP LOCKED` is what makes this safe: two
 * concurrent callers each lock a *different* candidate row (or get `null` once none remain),
 * rather than blocking on or double-reserving the same one.
 *
 * The `"isInUse" = false OR "reservedAt" < now() - interval '15 minutes'` clause is what reclaims
 * an abandoned reservation — see {@link RESERVATION_STALE_MINUTES}.
 */
export async function reserveAvailableProxy(prisma: PrismaClient): Promise<ReservedProxy | null> {
  const rows = await prisma.$queryRaw<ReservedProxy[]>`
    UPDATE "Proxy"
    SET "isInUse" = true, "reservedAt" = now(), "updatedAt" = now()
    WHERE id = (
      SELECT id FROM "Proxy"
      WHERE status = 'active'::"ProxyStatus"
        AND ("isInUse" = false OR "reservedAt" < now() - interval '${Prisma.raw(String(RESERVATION_STALE_MINUTES))} minutes')
      ORDER BY "errorCount" ASC, "updatedAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, host, port;
  `;
  return rows[0] ?? null;
}

/**
 * Marks a proxy available again — called unconditionally once a node's execution finishes
 * (success or failure alike), regardless of whether {@link reportProxyErrorAndMaybePurge} was
 * also called for the same id. Tolerates the row already being gone (P2025 "record not found"):
 * that happens exactly when this same error already pushed the proxy's error count past the
 * purge threshold and it was deleted — nothing left to release, not a bug to surface.
 */
export async function releaseProxy(prisma: PrismaClient, id: string): Promise<void> {
  try {
    await prisma.proxy.update({ where: { id }, data: { isInUse: false, reservedAt: null } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return;
    }
    throw error;
  }
}

/**
 * Records one more error against a proxy and purges it (a real `DELETE`, never just a status
 * flip — see `schema.prisma`'s own doc comment on `Proxy`) once its error count reaches the
 * configured threshold. The read-increment-decide sequence runs inside one transaction so two
 * near-simultaneous errors on the same proxy can't both read the count *before* either write,
 * which could let it exceed the threshold by more than one before either notices.
 */
export async function reportProxyErrorAndMaybePurge(
  prisma: PrismaClient,
  id: string,
): Promise<{ purged: boolean }> {
  return prisma.$transaction(async (tx) => {
    const config = await tx.proxyPoolConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });
    const updated = await tx.proxy.update({
      where: { id },
      data: { errorCount: { increment: 1 } },
    });
    if (updated.errorCount >= config.purgeErrorThreshold) {
      await tx.proxy.delete({ where: { id } });
      return { purged: true };
    }
    return { purged: false };
  });
}
