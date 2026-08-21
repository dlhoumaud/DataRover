import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  app.enableShutdownHooks();
  // Internal service, called only by apps/api (see render.client.ts there) — no browser ever
  // talks to this port directly, so no CORS/public-facing hardening is needed here.

  const port = process.env.BROWSER_WORKER_PORT ?? 3002;
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
