import { createServer } from "node:http";
import type { Server } from "node:http";
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
});
