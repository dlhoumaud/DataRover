import { PrismaClient } from "@prisma/client";

export { PrismaClient };

let instance: PrismaClient | undefined;

/**
 * Returns a lazily-instantiated, process-wide singleton PrismaClient.
 * Avoids opening multiple database connection pools when called repeatedly
 * (e.g. across module reloads in tests or dev hot-reload).
 */
export function getPrismaClient(): PrismaClient {
  if (!instance) {
    instance = new PrismaClient();
  }
  return instance;
}

/**
 * Disconnects and clears the singleton PrismaClient, if one was created.
 * Intended for tests (or graceful shutdown paths) that need to close the
 * underlying connection pool cleanly.
 */
export async function disconnectPrismaClient(): Promise<void> {
  if (instance) {
    await instance.$disconnect();
    instance = undefined;
  }
}
