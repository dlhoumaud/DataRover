import { createServer } from "node:http";
import type { Server } from "node:http";
import type { ExpressionContext } from "@datarover/expression-engine";
import type { BrowserActionNode } from "@datarover/workflow-types";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { browserActionExecutor } from "./browserActionExecutor.js";
import type { EngineVariables, NodeExecutionContext, ProxyPoolClient } from "./types.js";

function buildContext(
  expressionContext: ExpressionContext,
  overrides: Partial<NodeExecutionContext> = {},
): NodeExecutionContext {
  return {
    expressionContext: () => expressionContext,
    variables: { global: {}, project: {}, workflow: {} } satisfies EngineVariables,
    actionsOutput: {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

function fakeProxyPool(overrides: Partial<ProxyPoolClient> = {}): ProxyPoolClient {
  return {
    reserve: vi.fn(async () => ({ id: "proxy1", host: "10.0.0.5", port: 8080 })),
    reportError: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    ...overrides,
  };
}

function node(overrides: Partial<BrowserActionNode>): BrowserActionNode {
  return {
    id: "ba1",
    name: "Browser action",
    type: "browserAction",
    startUrl: "",
    steps: [{ type: "click", selector: "#submit" }],
    networkMode: "direct",
    ...overrides,
  };
}

/**
 * Stands in for `apps/browser-worker`'s `POST /session/run` — a plain Node HTTP server (same
 * fixture style as `apps/browser-worker/test/render.e2e.test.ts`), since this executor never
 * touches Playwright itself and its only real collaborator across the wire is that one route.
 */
describe("browserActionExecutor", () => {
  let server: Server;
  let baseUrl: string;
  let lastRequestBody: unknown;
  let nextResponse: { statusCode: number; body: unknown };
  const originalBrowserWorkerUrl = process.env.BROWSER_WORKER_URL;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on("end", () => {
        lastRequestBody = raw.length > 0 ? JSON.parse(raw) : undefined;
        res.writeHead(nextResponse.statusCode, { "content-type": "application/json" });
        res.end(JSON.stringify(nextResponse.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fixture server did not bind to a TCP port");
    }
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
    process.env.BROWSER_WORKER_URL = baseUrl;
  });

  afterEach(() => {
    lastRequestBody = undefined;
  });

  afterAll(async () => {
    process.env.BROWSER_WORKER_URL = originalBrowserWorkerUrl;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("posts the interpolated startUrl/steps to browser-worker's /session/run and returns its output", async () => {
    nextResponse = { statusCode: 200, body: { status: 200, html: "<html>ok</html>" } };
    const ctx = buildContext({ global: { target: "https://example.com/login", user: "alice" } });

    const result = await browserActionExecutor(
      node({
        startUrl: "{{ global.target }}",
        steps: [
          { type: "type", selector: "#user", text: "{{ global.user }}" },
          { type: "click", selector: "#submit" },
        ],
      }),
      ctx,
    );

    expect(lastRequestBody).toEqual({
      startUrl: "https://example.com/login",
      steps: [
        { type: "type", selector: "#user", text: "alice" },
        { type: "click", selector: "#submit" },
      ],
    });
    expect(result.output).toEqual({ status: 200, html: "<html>ok</html>" });
  });

  it("interpolates every templated field across step variants", async () => {
    nextResponse = { statusCode: 200, body: { status: 200, html: "<html></html>" } };
    const ctx = buildContext({ global: { sel: "#dyn", url: "https://example.com/next", key: "Enter" } });

    await browserActionExecutor(
      node({
        startUrl: "https://example.com",
        steps: [
          { type: "navigate", url: "{{ global.url }}" },
          { type: "hover", selector: "{{ global.sel }}" },
          { type: "press", key: "{{ global.key }}" },
          { type: "select", selector: "{{ global.sel }}", value: "fr" },
          { type: "dragTo", sourceSelector: "{{ global.sel }}", targetSelector: "#bin" },
          { type: "scrollIntoView", selector: "{{ global.sel }}" },
          { type: "waitForSelector", selector: "{{ global.sel }}" },
          { type: "scrollPage", x: 0, y: 200 },
          { type: "moveMouse", x: 120, y: 340, delay: { kind: "fixed", ms: 80 } },
          { type: "moveMouseRandom", delay: { kind: "random", minMs: 20, maxMs: 90 } },
          { type: "wait", ms: 100 },
        ],
      }),
      ctx,
    );

    expect(lastRequestBody).toMatchObject({
      steps: [
        { type: "navigate", url: "https://example.com/next" },
        { type: "hover", selector: "#dyn" },
        { type: "press", key: "Enter" },
        { type: "select", selector: "#dyn", value: "fr" },
        { type: "dragTo", sourceSelector: "#dyn", targetSelector: "#bin" },
        { type: "scrollIntoView", selector: "#dyn" },
        { type: "waitForSelector", selector: "#dyn" },
        { type: "scrollPage", x: 0, y: 200 },
        // Plain numbers/DelaySpec — passed through untouched, nothing to interpolate.
        { type: "moveMouse", x: 120, y: 340, delay: { kind: "fixed", ms: 80 } },
        { type: "moveMouseRandom", delay: { kind: "random", minMs: 20, maxMs: 90 } },
        { type: "wait", ms: 100 },
      ],
    });
  });

  it("passes a type step's delay spec through untouched while still interpolating its text/selector", async () => {
    nextResponse = { statusCode: 200, body: { status: 200, html: "<html></html>" } };
    const ctx = buildContext({ global: { user: "alice" } });

    await browserActionExecutor(
      node({
        startUrl: "https://example.com",
        steps: [
          { type: "type", selector: "#user", text: "{{ global.user }}", delay: { kind: "random", minMs: 30, maxMs: 120 } },
        ],
      }),
      ctx,
    );

    expect(lastRequestBody).toEqual({
      startUrl: "https://example.com",
      steps: [{ type: "type", selector: "#user", text: "alice", delay: { kind: "random", minMs: 30, maxMs: 120 } }],
    });
  });

  it("throws with browser-worker's error message when the target/sequence fails (400)", async () => {
    nextResponse = { statusCode: 400, body: { message: "Failed to navigate: ENOTFOUND" } };
    const ctx = buildContext({});

    await expect(
      browserActionExecutor(node({ startUrl: "https://nope.invalid" }), ctx),
    ).rejects.toThrow(/Failed to navigate: ENOTFOUND/);
  });

  it("throws a clear error when browser-worker is unreachable", async () => {
    process.env.BROWSER_WORKER_URL = "http://127.0.0.1:1"; // ERR_UNSAFE_PORT-ish/refused, never listening
    const ctx = buildContext({});

    await expect(browserActionExecutor(node({ startUrl: "https://example.com" }), ctx)).rejects.toThrow(
      /Could not reach the browser-worker service/,
    );

    process.env.BROWSER_WORKER_URL = baseUrl;
  });

  describe("networkMode: 'proxy'", () => {
    it("reserves a proxy, forwards its host/port to browser-worker, and releases it on success", async () => {
      nextResponse = { statusCode: 200, body: { status: 200, html: "<html>ok</html>" } };
      const proxyPool = fakeProxyPool();
      const ctx = buildContext({}, { proxyPool });

      const result = await browserActionExecutor(
        node({ startUrl: "https://example.com", networkMode: "proxy" }),
        ctx,
      );

      expect(lastRequestBody).toMatchObject({ proxy: { host: "10.0.0.5", port: 8080 } });
      expect(result.output).toEqual({ status: 200, html: "<html>ok</html>" });
      expect(proxyPool.reserve).toHaveBeenCalledOnce();
      expect(proxyPool.release).toHaveBeenCalledWith("proxy1");
      expect(proxyPool.reportError).not.toHaveBeenCalled();
    });

    it("throws a clear error when networkMode is 'proxy' but no proxy pool is wired up", async () => {
      const ctx = buildContext({});

      await expect(
        browserActionExecutor(node({ startUrl: "https://example.com", networkMode: "proxy" }), ctx),
      ).rejects.toThrow(/no proxy pool/i);
    });

    it("throws a clear error when the pool has nothing available", async () => {
      const proxyPool = fakeProxyPool({ reserve: vi.fn(async () => null) });
      const ctx = buildContext({}, { proxyPool });

      await expect(
        browserActionExecutor(node({ startUrl: "https://example.com", networkMode: "proxy" }), ctx),
      ).rejects.toThrow(/no proxy is currently available/i);
      expect(proxyPool.release).not.toHaveBeenCalled();
    });

    it("reports an error and still releases the proxy when browser-worker rejects the sequence (400)", async () => {
      nextResponse = { statusCode: 400, body: { message: "Failed to navigate: net::ERR_PROXY_CONNECTION_FAILED" } };
      const proxyPool = fakeProxyPool();
      const ctx = buildContext({}, { proxyPool });

      await expect(
        browserActionExecutor(node({ startUrl: "https://example.com", networkMode: "proxy" }), ctx),
      ).rejects.toThrow(/ERR_PROXY_CONNECTION_FAILED/);
      expect(proxyPool.reportError).toHaveBeenCalledWith("proxy1");
      expect(proxyPool.release).toHaveBeenCalledWith("proxy1");
    });

    it("does NOT report a proxy error when browser-worker itself is unreachable — an infra problem, not the proxy's fault", async () => {
      process.env.BROWSER_WORKER_URL = "http://127.0.0.1:1";
      const proxyPool = fakeProxyPool();
      const ctx = buildContext({}, { proxyPool });

      await expect(
        browserActionExecutor(node({ startUrl: "https://example.com", networkMode: "proxy" }), ctx),
      ).rejects.toThrow(/Could not reach the browser-worker service/);
      expect(proxyPool.reportError).not.toHaveBeenCalled();
      expect(proxyPool.release).toHaveBeenCalledWith("proxy1");

      process.env.BROWSER_WORKER_URL = baseUrl;
    });
  });
});
