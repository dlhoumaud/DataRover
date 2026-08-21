import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";

/**
 * Boots this app with a real, listening TCP port — required for any test touching
 * `/session/live`: the usual `.inject()` (light-my-request, used everywhere else in this repo's
 * e2e suites) is a synthetic request/response shim with no real duplex socket, so it can't
 * perform an HTTP Upgrade to WebSocket at all. A real `app.listen(0)` plus a real `ws` client
 * (see the tests that use this) is the only way to exercise that route for real.
 */
export async function startLiveApp(): Promise<{ app: NestFastifyApplication; wsUrl: string; close: () => Promise<void> }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.listen(0, "127.0.0.1");

  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("App did not bind to a TCP port");
  }

  return {
    app,
    wsUrl: `ws://127.0.0.1:${String(address.port)}/session/live`,
    close: () => app.close(),
  };
}
