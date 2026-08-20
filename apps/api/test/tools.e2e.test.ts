import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const FIXTURE_HTML = `<!doctype html>
<html>
  <body>
    <div class="product-card">
      <span class="title" data-testid="title">Produit A</span>
      <span class="price">19.99</span>
    </div>
    <div class="product-card">
      <span class="title" data-testid="title">Produit B</span>
      <span class="price">29.99</span>
    </div>
  </body>
</html>`;

// A well-known 1x1 transparent PNG, used to verify preview-asset proxies real binary bytes
// byte-for-byte (not just "some non-empty response") with the correct content-type.
const FIXTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Stands in for the real apps/browser-worker service: `ToolsService`'s `render: true` branch only
 * needs to correctly call out to `BROWSER_WORKER_URL` and translate its response — actually
 * driving a real browser (JS execution, consent-banner dismissal) is apps/browser-worker's own
 * responsibility, already covered end to end by apps/browser-worker/test/render.e2e.test.ts
 * against a real Chrome. Testing that here too would just be a slower, redundant duplicate of the
 * same coverage instead of testing this app's own actual job: the HTTP proxying/error-translation
 * in BrowserWorkerClient.
 */
function startFixtureBrowserWorker(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/render") {
        res.writeHead(404);
        res.end();
        return;
      }
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on("end", () => {
        const body = JSON.parse(raw) as { url: string; headers?: Record<string, string> };
        if (body.url.endsWith("/spa")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: 200, html: "<h1>Produit rendu</h1>" }));
          return;
        }
        if (body.url.endsWith("/consent")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: 200, html: "<div>Contenu reel du produit</div>" }));
          return;
        }
        if (body.url.endsWith("/echo-headers")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: 200, html: JSON.stringify(body.headers ?? {}) }));
          return;
        }
        if (body.url.endsWith("/render-fails")) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: `Failed to navigate to "${body.url}": simulated failure` }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Fixture browser-worker did not bind to a TCP port"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${String(address.port)}` });
    });
  });
}

describe("Tools", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let server: Server;
  let baseUrl: string;
  let browserWorkerServer: Server;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    // Set before compiling AppModule: BrowserWorkerClient reads BROWSER_WORKER_URL at
    // construction time, when Nest instantiates ToolsModule's providers.
    const browserWorker = await startFixtureBrowserWorker();
    browserWorkerServer = browserWorker.server;
    process.env.BROWSER_WORKER_URL = browserWorker.url;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    prisma = app.get(PrismaService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    server = createServer((req, res) => {
      if (req.url === "/catalog") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(FIXTURE_HTML);
        return;
      }
      if (req.url === "/pixel.png") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(FIXTURE_PNG);
        return;
      }
      if (req.url === "/consent") {
        // Simulates a full-screen cookie-consent overlay blocking real content underneath —
        // exactly what a real render of a reported site showed via screenshot. The "accept"
        // button removes the overlay itself (a plain inline handler is enough for the test; the
        // real dismissConsentBanner logic finds it via its French accept-like text either way).
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
      if (req.url === "/spa") {
        // Simulates a client-rendered SPA: the real content only exists after this inline
        // script runs — a plain fetch never sees it, only a real render (render: true) does.
        // The two words are concatenated at runtime (never appearing together as one literal
        // string in the source) so a naive substring check on the raw, unexecuted HTML can't
        // accidentally "see" the rendered text inside the script's own source code.
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><html><body><div id="app">Chargement…</div>` +
            `<script>document.getElementById("app").innerHTML = "<h1>" + ["Produit", "rendu"].join(" ") + "</h1>";</script>` +
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

  afterEach(async () => {
    while (createdProjectIds.length > 0) {
      const id = createdProjectIds.pop();
      if (id) {
        await prisma.project.deleteMany({ where: { id } });
      }
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      browserWorkerServer.close((error) => (error ? reject(error) : resolve()));
    });
    await app.close();
  });

  async function createProject(variables: Record<string, unknown>): Promise<string> {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/projects",
      payload: { name: `e2e-tools-project-${randomUUID()}`, variables },
    });
    const project = JSON.parse(response.payload) as { id: string };
    createdProjectIds.push(project.id);
    return project.id;
  }

  describe("POST /tools/preview-html", () => {
    it("interpolates the URL against the project's global variables and returns the fetched HTML", async () => {
      const projectId = await createProject({ baseUrl });

      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId, method: "GET", url: "{{ global.baseUrl }}/catalog" },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { status: number; html: string };
      expect(body.status).toBe(200);
      expect(body.html).toContain("Produit A");
      expect(body.html).toContain("product-card");
    });

    it("returns 400 for a non-existent project", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId: "does-not-exist", method: "GET", url: "http://example.com" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when the target is unreachable", async () => {
      const projectId = await createProject({});
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId, method: "GET", url: "http://127.0.0.1:1/nope" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("plain-fetches by default, missing content that only exists after client-side JS runs", async () => {
      const projectId = await createProject({ baseUrl });
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId, method: "GET", url: "{{ global.baseUrl }}/spa" },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { html: string };
      expect(body.html).toContain("Chargement");
      expect(body.html).not.toContain("Produit rendu");
    });

    // The four tests below exercise BrowserWorkerClient against the fixture browser-worker
    // (startFixtureBrowserWorker, above) — proving apps/api correctly calls out to
    // BROWSER_WORKER_URL and translates its response/errors. Actually driving a real browser is
    // apps/browser-worker's own job, verified there against a real Chrome
    // (apps/browser-worker/test/render.e2e.test.ts) — duplicating that here would only make this
    // suite slower without covering anything new.

    it("with render: true, forwards the interpolated URL and headers to the browser-worker and returns its result", async () => {
      const projectId = await createProject({ baseUrl });
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId, method: "GET", url: "{{ global.baseUrl }}/spa", render: true },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { html: string };
      expect(body.html).toBe("<h1>Produit rendu</h1>");
    });

    it("with render: true, returns whatever HTML the browser-worker reports (e.g. post-consent-dismissal content)", async () => {
      const projectId = await createProject({ baseUrl });
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId, method: "GET", url: "{{ global.baseUrl }}/consent", render: true },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { html: string };
      expect(body.html).toBe("<div>Contenu reel du produit</div>");
    });

    it("with render: true, forwards interpolated headers through to the browser-worker's request body", async () => {
      const projectId = await createProject({ baseUrl });
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: {
          projectId,
          method: "GET",
          url: "{{ global.baseUrl }}/echo-headers",
          headers: { "x-custom-header": "hello" },
          render: true,
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { html: string };
      expect(JSON.parse(body.html)).toEqual({ "x-custom-header": "hello" });
    });

    it("with render: true, surfaces a browser-worker-reported render failure as a 400", async () => {
      const projectId = await createProject({ baseUrl });
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId, method: "GET", url: "{{ global.baseUrl }}/render-fails", render: true },
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when render: true is combined with a non-GET method", async () => {
      const projectId = await createProject({});
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/preview-html",
        payload: { projectId, method: "POST", url: "http://example.com", render: true },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /tools/test-selector", () => {
    it("scores every candidate CSS selector and returns the value from the first one that matches (sourceType defaults to html)", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/test-selector",
        payload: {
          source: FIXTURE_HTML,
          selectors: ["div > span:nth-child(3)", '[data-testid="title"]', ".product-card .title"],
          output: "list",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as {
        value: unknown;
        matchedSelector: string;
        selectorScores: Array<{ selector: string; score: number; matched: boolean }>;
      };
      expect(body.value).toEqual(["Produit A", "Produit B"]);
      expect(body.matchedSelector).toBe('[data-testid="title"]');
      expect(body.selectorScores).toHaveLength(3);
      const testIdScore = body.selectorScores.find((s) => s.selector === '[data-testid="title"]');
      const fragileScore = body.selectorScores.find((s) => s.selector === "div > span:nth-child(3)");
      expect(testIdScore?.score ?? 0).toBeGreaterThan(fragileScore?.score ?? 100);
    });

    it("returns 400 when no selector is provided", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/test-selector",
        payload: { source: FIXTURE_HTML, selectors: [] },
      });
      expect(response.statusCode).toBe(400);
    });

    it("evaluates a JSONPath selector when sourceType is json, parsing the raw source itself", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/test-selector",
        payload: {
          source: JSON.stringify({ items: [{ price: 19.99 }, { price: 29.99 }] }),
          sourceType: "json",
          selectors: ["$.items[1].price"],
          output: "value",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { value: unknown; matchedSelector: string };
      expect(body.value).toBe(29.99);
      expect(body.matchedSelector).toBe("$.items[1].price");
    });

    it("returns 400 for an invalid JSON source", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/test-selector",
        payload: { source: "{not valid json", sourceType: "json", selectors: ["$.a"] },
      });
      expect(response.statusCode).toBe(400);
    });

    it("parses XML and evaluates a JSONPath selector (including an attribute) when sourceType is xml", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        url: "/tools/test-selector",
        payload: {
          source: `<catalog><product id="p1"><price>19.99</price></product></catalog>`,
          sourceType: "xml",
          selectors: ["$.catalog.product['attr_id']"],
          output: "value",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload) as { value: unknown };
      expect(body.value).toBe("p1");
    });
  });

  describe("GET /tools/preview-asset", () => {
    it("proxies an asset byte-for-byte with its origin content-type", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: `/tools/preview-asset?url=${encodeURIComponent(`${baseUrl}/pixel.png`)}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("image/png");
      expect(Buffer.compare(response.rawPayload, FIXTURE_PNG)).toBe(0);
    });

    it("returns 400 for a malformed URL", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: `/tools/preview-asset?url=${encodeURIComponent("not a url")}`,
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for a non-http(s) protocol", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: `/tools/preview-asset?url=${encodeURIComponent("file:///etc/passwd")}`,
      });
      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when the target is unreachable", async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: `/tools/preview-asset?url=${encodeURIComponent("http://127.0.0.1:1/nope")}`,
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
