import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";

// Needs a real system Chrome/Chromium available (see chromeBinary.ts) — same assumption as
// apps/web's browser e2e suite needing a real Firefox, and as apps/api/test/tools.e2e.test.ts's
// own render tests before this service existed.
describe("POST /render", () => {
  let app: NestFastifyApplication;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    server = createServer((req, res) => {
      if (req.url === "/spa") {
        // Simulates a client-rendered SPA: the real content only exists after this inline
        // script runs — a plain fetch never sees it, only a real render does. The two words are
        // concatenated at runtime so a naive substring check on the raw HTML can't "see" the
        // rendered text sitting inside the script's own unexecuted source.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><body><div id="app">Chargement…</div>` +
            `<script>document.getElementById("app").innerHTML = "<h1>" + ["Produit", "rendu"].join(" ") + "</h1>";</script>` +
            `</body></html>`,
        );
        return;
      }
      if (req.url === "/consent") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><body>` +
            `<div id="overlay">Ce site utilise des cookies.` +
            `<button onclick="document.getElementById('overlay').remove()">Tout accepter</button></div>` +
            `<div id="real-content">Contenu reel du produit</div>` +
            `</body></html>`,
        );
        return;
      }
      if (req.url === "/echo-headers") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><body>${req.headers["x-custom-header"] ?? "none"}</body></html>`);
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await app.close();
  });

  it("executes the page's JS in a real headless browser and captures the result", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/render",
      payload: { url: `${baseUrl}/spa` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { status: number; html: string };
    expect(body.status).toBe(200);
    expect(body.html).toContain("Produit rendu");
  }, 30_000);

  it("dismisses a full-screen consent overlay before capturing the DOM", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/render",
      payload: { url: `${baseUrl}/consent` },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { html: string };
    expect(body.html).toContain("Contenu reel du produit");
    expect(body.html).not.toContain("Ce site utilise des cookies");
  }, 30_000);

  it("forwards extra headers to the target page's navigation request", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/render",
      payload: { url: `${baseUrl}/echo-headers`, headers: { "x-custom-header": "hello-from-test" } },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload) as { html: string };
    expect(body.html).toContain("hello-from-test");
  }, 30_000);

  it("returns 400 (not 500) when the target is unreachable", async () => {
    // Port 65535 on loopback: not one of the handful of ports Chrome itself refuses to dial
    // (ERR_UNSAFE_PORT, e.g. port 1) — a plain, ordinary "nothing is listening here" failure.
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/render",
      payload: { url: "http://127.0.0.1:65535/nope" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 400 for a request with no url", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/render",
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});
