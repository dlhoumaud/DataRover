import { Controller, Get } from "@nestjs/common";
import Redis from "ioredis";
import { getRedisConnectionOptions } from "@datarover/queue";
import { PrismaService } from "../prisma/prisma.service";

type DependencyStatus = "ok" | "error";

export interface HealthResponse {
  status: "ok" | "degraded";
  db: DependencyStatus;
  redis: DependencyStatus;
}

/**
 * Liveness/readiness endpoint. Must never throw: both dependency checks are
 * wrapped so a down Postgres or Redis is reported as "degraded" with a 200,
 * rather than crashing the request.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    const status: "ok" | "degraded" = db === "ok" && redis === "ok" ? "ok" : "degraded";
    return { status, db, redis };
  }

  private async checkDb(): Promise<DependencyStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch {
      return "error";
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const options = getRedisConnectionOptions();
    const client = new Redis({
      host: options.host,
      port: options.port,
      password: options.password,
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    try {
      await client.connect();
      const pong = await client.ping();
      return pong === "PONG" ? "ok" : "error";
    } catch {
      return "error";
    } finally {
      client.disconnect();
    }
  }
}
