import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableShutdownHooks();
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:5173" });

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
