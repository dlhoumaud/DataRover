import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { connect as netConnect } from "node:net";
import type { Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";

// Same real-Chrome assumption as render.e2e.test.ts (see its own comment).
describe("POST /session/run", () => {
  let app: NestFastifyApplication;
  let server: Server;
  let baseUrl: string;
  const originalAllowlist = process.env.BROWSER_WORKER_SSRF_ALLOWLIST;

  beforeAll(async () => {
    // The fixture server below binds to loopback, same as ssrfGuard.ts would otherwise reject —
    // allowlisted here purely so these tests can exercise the real /session/run route end to end
    // against a real local fixture; the SSRF-rejection test itself below targets a *different*,
    // non-allowlisted private address instead.
    process.env.BROWSER_WORKER_SSRF_ALLOWLIST = "127.0.0.1";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    server = createServer((req, res) => {
      if (req.url === "/form") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><body>` +
            `<input id="q" type="text" />` +
            `<div id="result">waiting</div>` +
            `<button id="go" onclick="document.getElementById('result').textContent = 'submitted:' + document.getElementById('q').value">Go</button>` +
            `</body></html>`,
        );
        return;
      }
      if (req.url === "/next") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><body><div id="landed">landed</div></body></html>`);
        return;
      }
      if (req.url === "/mouse") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><body>` +
            `<div id="mousepos">none</div>` +
            `<script>document.addEventListener("mousemove", function (e) {` +
            `document.getElementById("mousepos").textContent = e.clientX + "," + e.clientY; });</script>` +
            `</body></html>`,
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fixture server did not bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    process.env.BROWSER_WORKER_SSRF_ALLOWLIST = originalAllowlist;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await app.close();
  });

  it("types character-by-character and clicks, then returns the resulting DOM", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: {
        startUrl: `${baseUrl}/form`,
        steps: [
          { type: "type", selector: "#q", text: "hello" },
          { type: "click", selector: "#go" },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { status: number; html: string };
    expect(body.status).toBe(200);
    expect(body.html).toContain("submitted:hello");
  }, 30_000);

  it("types with a random per-keystroke delay and still produces the correct text", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: {
        startUrl: `${baseUrl}/form`,
        steps: [
          { type: "type", selector: "#q", text: "hello", delay: { kind: "random", minMs: 5, maxMs: 15 } },
          { type: "click", selector: "#go" },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { html: string };
    expect(body.html).toContain("submitted:hello");
  }, 30_000);

  it("moves the mouse to an exact position", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: {
        startUrl: `${baseUrl}/mouse`,
        steps: [{ type: "moveMouse", x: 200, y: 150, delay: { kind: "fixed", ms: 10 } }],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { html: string };
    expect(body.html).toContain("200,150");
  }, 30_000);

  it("moves the mouse to a random position (some movement happens, exact target is non-deterministic by design)", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: {
        startUrl: `${baseUrl}/mouse`,
        steps: [{ type: "moveMouseRandom", delay: { kind: "random", minMs: 5, maxMs: 15 } }],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { html: string };
    expect(body.html).not.toContain(">none<");
  }, 30_000);

  it("follows a navigate step to a second page", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: {
        startUrl: `${baseUrl}/form`,
        steps: [{ type: "navigate", url: `${baseUrl}/next` }],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { html: string };
    expect(body.html).toContain("landed");
  }, 30_000);

  it("returns 400 (not 500) when startUrl resolves to a non-allowlisted private address", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: {
        // Not the fixture server's (allowlisted) 127.0.0.1 — a distinct private address the SSRF
        // guard must still reject on its own, exercising the guard rather than a navigation failure.
        startUrl: "http://10.0.0.1/nope",
        steps: [{ type: "wait", ms: 10 }],
      },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload) as { message?: string };
    expect(JSON.stringify(body)).toMatch(/private|internal/i);
  });

  it("returns 400 when a step's selector never appears", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: {
        startUrl: `${baseUrl}/form`,
        steps: [{ type: "click", selector: "#does-not-exist" }],
      },
    });
    expect(response.statusCode).toBe(400);
  }, 30_000);

  it("returns 400 for a request with no steps", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/session/run",
      payload: { startUrl: `${baseUrl}/form`, steps: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  describe("proxy", () => {
    let proxy: Server;
    let proxyPort: number;
    let forwardedRequestCount: number;

    beforeAll(async () => {
      // A real HTTP forward proxy, handling both request styles a real Chrome actually uses —
      // unlike a client library such as undici (which tunnels everything through CONNECT by
      // default), a browser only tunnels **https**/wss targets: a plain **http** target (this
      // fixture's own `baseUrl`) is instead forwarded via a normal request whose request line
      // carries the absolute URI, sent directly to the proxy, no CONNECT involved. Both paths are
      // implemented since a real Chrome session also opens CONNECT tunnels for its own background
      // traffic (Safe Browsing, sign-in state, …) over this same configured proxy regardless of
      // what the test itself navigates to.
      proxy = createServer((req, res) => {
        forwardedRequestCount += 1;
        const forwarded = httpRequest(req.url ?? "", { method: req.method, headers: req.headers }, (targetRes) => {
          res.writeHead(targetRes.statusCode ?? 502, targetRes.headers);
          targetRes.pipe(res);
        });
        // Real Chrome tears connections down abruptly once it's done with them (especially its
        // own background traffic, closed well before this fixture ever shuts down) — an unhandled
        // 'error' on either leg would otherwise crash the process with an EPIPE/ECONNRESET.
        forwarded.on("error", () => {});
        res.on("error", () => {});
        req.pipe(forwarded);
      });
      forwardedRequestCount = 0;
      proxy.on("connect", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
        const [host, portText] = (req.url ?? "").split(":");
        const serverSocket = netConnect(Number(portText), host, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        });
        serverSocket.on("error", () => {});
        clientSocket.on("error", () => {});
      });
      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const proxyAddress = proxy.address();
      if (proxyAddress === null || typeof proxyAddress === "string") {
        throw new Error("Fixture proxy did not bind to a TCP port");
      }
      proxyPort = proxyAddress.port;
    });

    afterAll(async () => {
      // A real Chrome tunnels its own background traffic (Safe Browsing, sign-in checks, …)
      // through this proxy too, alongside the actual test navigation — some of those connections
      // are kept alive well past the end of the test, which would otherwise make a graceful
      // `close()` hang waiting for them. `closeAllConnections()` (Node 18.2+) tears them down
      // immediately instead.
      proxy.closeAllConnections();
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    });

    it("navigates through the given proxy when one is supplied", async () => {
      const countBefore = forwardedRequestCount;

      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/session/run",
        payload: {
          startUrl: `${baseUrl}/form`,
          steps: [{ type: "wait", ms: 10 }],
          proxy: { host: "127.0.0.1", port: proxyPort },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { html: string };
      expect(body.html).toContain("waiting");
      expect(forwardedRequestCount).toBeGreaterThan(countBefore);
    }, 30_000);

    it("returns 400 for a malformed proxy payload (missing port)", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/session/run",
        payload: {
          startUrl: `${baseUrl}/form`,
          steps: [{ type: "wait", ms: 10 }],
          proxy: { host: "127.0.0.1" },
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 (not a hang) when the given proxy is unreachable", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/session/run",
        payload: {
          startUrl: `${baseUrl}/form`,
          steps: [{ type: "wait", ms: 10 }],
          proxy: { host: "127.0.0.1", port: 1 },
        },
      });
      expect(response.statusCode).toBe(400);
    }, 30_000);
  });
});
