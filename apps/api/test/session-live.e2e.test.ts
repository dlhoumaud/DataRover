import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { WebSocket, WebSocketServer } from "ws";
import { AppModule } from "../src/app.module";

/**
 * Stands in for `apps/browser-worker`'s real `/session/live` — this app's own job is proxying a
 * WS connection through correctly (relay both ways, propagate a close from either side), not
 * driving a real browser: that's already covered end to end, against a real Chrome, by
 * `apps/browser-worker/test/session-live.e2e.test.ts`. Same split of responsibility
 * `tools.e2e.test.ts`'s own fixture browser-worker already documents for the batch/preview paths.
 */
function startFixtureUpstream(): Promise<{ server: WebSocketServer; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("Fixture upstream did not bind to a TCP port");
      }
      resolve({
        server: wss,
        url: `http://127.0.0.1:${String(address.port)}`,
        close: () =>
          new Promise<void>((res, rej) => {
            wss.close((error) => (error ? rej(error) : res()));
          }).then(() => new Promise<void>((res, rej) => httpServer.close((error) => (error ? rej(error) : res())))),
      });
    });
  });
}

describe("GET /tools/session-live (WS proxy)", () => {
  let app: NestFastifyApplication;
  let apiWsUrl: string;
  let upstream: WebSocketServer;
  let closeUpstream: () => Promise<void>;

  beforeAll(async () => {
    const fixture = await startFixtureUpstream();
    upstream = fixture.server;
    closeUpstream = fixture.close;
    // Set before compiling AppModule — matches tools.e2e.test.ts's own BrowserWorkerClient
    // convention, even though this gateway happens to re-read it per-connection rather than at
    // construction time.
    process.env.BROWSER_WORKER_URL = fixture.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    // A real, listening port — `.inject()` (used by every other apps/api e2e test) is a synthetic
    // request/response shim with no real duplex socket, so it can't perform a WebSocket Upgrade.
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    if (address === null || typeof address === "string") {
      throw new Error("App did not bind to a TCP port");
    }
    apiWsUrl = `ws://127.0.0.1:${String(address.port)}/tools/session-live`;
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await closeUpstream();
  });

  const openSockets: WebSocket[] = [];
  afterEach(() => {
    for (const socket of openSockets.splice(0)) {
      try {
        // A socket still CONNECTING (e.g. left over from a test that failed before it opened)
        // throws on .close() rather than just closing — a cleanup hook has to tolerate that.
        socket.close();
      } catch {
        // Already closed/closing, or never finished opening — nothing left to clean up either way.
      }
    }
    upstream.removeAllListeners("connection");
  });

  function connectClient(): WebSocket {
    const socket = new WebSocket(apiWsUrl);
    openSockets.push(socket);
    return socket;
  }

  function waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
  }

  function waitForMessage(socket: WebSocket, timeoutMs = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for a message`)), timeoutMs);
      socket.once("message", (data: Buffer) => {
        clearTimeout(timer);
        resolve(data.toString());
      });
    });
  }

  function waitForUpstreamConnection(): Promise<WebSocket> {
    return new Promise((resolve) => {
      upstream.once("connection", (socket) => resolve(socket as unknown as WebSocket));
    });
  }

  it("relays a message from the browser to the upstream, and the upstream's reply back", async () => {
    const upstreamConnectionPromise = waitForUpstreamConnection();
    const client = connectClient();
    await waitForOpen(client);
    const upstreamSocket = await upstreamConnectionPromise;

    upstreamSocket.on("message", (data: Buffer) => {
      upstreamSocket.send(`echo:${data.toString()}`);
    });

    client.send(JSON.stringify({ type: "start", startUrl: "https://example.com" }));
    const reply = await waitForMessage(client);
    expect(reply).toBe('echo:{"type":"start","startUrl":"https://example.com"}');
  });

  it("queues a message sent before the upstream connection finishes opening", async () => {
    const upstreamConnectionPromise = waitForUpstreamConnection();
    const client = connectClient();
    await waitForOpen(client);
    // The browser<->proxy leg is open, but the proxy<->upstream leg (opened the moment the proxy
    // accepted this connection) is very likely still mid-handshake at this exact instant — this
    // asserts the *outcome* (the message still arrives) rather than the precise race window, which
    // depends on timing this test can observe but not control.
    client.send(JSON.stringify({ type: "hello" }));

    const upstreamSocket = await upstreamConnectionPromise;
    const received = await new Promise<string>((resolve) => {
      upstreamSocket.once("message", (data: Buffer) => resolve(data.toString()));
    });
    expect(received).toBe('{"type":"hello"}');
  });

  it("closes the upstream connection when the browser closes its side", async () => {
    const upstreamConnectionPromise = waitForUpstreamConnection();
    const client = connectClient();
    await waitForOpen(client);
    const upstreamSocket = await upstreamConnectionPromise;

    const upstreamClosed = new Promise<void>((resolve) => {
      upstreamSocket.once("close", () => resolve());
    });
    client.close();
    await upstreamClosed;
  });

  it("closes the browser-facing connection when the upstream closes its side", async () => {
    const upstreamConnectionPromise = waitForUpstreamConnection();
    const client = connectClient();
    await waitForOpen(client);
    const upstreamSocket = await upstreamConnectionPromise;

    const clientClosed = new Promise<void>((resolve) => {
      client.once("close", () => resolve());
    });
    upstreamSocket.close();
    await clientClosed;
  });
});
