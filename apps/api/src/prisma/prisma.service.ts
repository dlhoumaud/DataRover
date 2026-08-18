import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@datarover/database";

/**
 * Thin NestJS wrapper around the shared `@datarover/database` `PrismaClient`.
 *
 * Hooked into Nest's lifecycle so the connection pool is opened once the
 * module graph is ready and cleanly closed on application shutdown
 * (`app.enableShutdownHooks()` in `main.ts` is what triggers `onModuleDestroy`).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
