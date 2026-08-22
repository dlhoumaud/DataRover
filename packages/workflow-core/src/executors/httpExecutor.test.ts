import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { connect as netConnect } from "node:net";
import type { Socket } from "node:net";
import type { ExpressionContext } from "@datarover/expression-engine";
import type { HttpNode } from "@datarover/workflow-types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { httpExecutor } from "./httpExecutor.js";
import type { EngineVariables, NodeExecutionContext, ProxyPoolClient } from "./types.js";

function node(overrides: Partial<HttpNode>): HttpNode {
  return {
    id: "h1",
    name: "HTTP node",
    type: "http",
    method: "GET",
    url: "",
    responseType: "json",
    networkMode: "direct",
    ...overrides,
  };
}

function buildContext(overrides: Partial<NodeExecutionContext> = {}): NodeExecutionContext {
  const expressionContext: ExpressionContext = { global: {}, project: {}, workflow: {}, actions: {} };
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
    reserve: vi.fn(async () => ({ id: "proxy1", host: "127.0.0.1", port: 0 })),
    reportError: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("httpExecutor", () => {
  describe("networkMode: 'direct' (default)", () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      server = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Fixture server did not bind to a TCP port");
      }
      baseUrl = `http://127.0.0.1:${String(address.port)}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });

    it("makes a plain request without ever touching ctx.proxyPool", async () => {
      const proxyPool = fakeProxyPool();
      const result = await httpExecutor(node({ url: baseUrl }), buildContext({ proxyPool }));

      expect((result.output as { status: number }).status).toBe(200);
      expect(proxyPool.reserve).not.toHaveBeenCalled();
    });
  });

  describe("networkMode: 'proxy'", () => {
    let target: Server;
    let targetUrl: string;
    let proxy: Server;
    let proxyPort: number;
    let connectCount: number;

    beforeAll(async () => {
      target = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
      const targetAddress = target.address();
      if (targetAddress === null || typeof targetAddress === "string") {
        throw new Error("Fixture target did not bind to a TCP port");
      }
      targetUrl = `http://127.0.0.1:${String(targetAddress.port)}`;

      // A real HTTP CONNECT-tunnel proxy — undici's `ProxyAgent` tunnels by default
      // (`proxyTunnel: true`, its own default) regardless of whether the target is http or https,
      // so a "dumb" forward proxy that only re-issues absolute-URI requests (the simpler
      // `proxyTunnel: false` mode) never even gets a connection from it. This is the standard
      // Node "CONNECT proxy" pattern: accept the tunnel, open a raw TCP connection to the real
      // target, reply 200, then relay bytes both ways — from that point on it's opaque to the
      // proxy, exactly like a real one. `connectCount` is what proves a request genuinely went
      // through this fixture, since there's no HTTP-level hook left to tag a response with once
      // it's tunneled.
      proxy = createServer();
      connectCount = 0;
      proxy.on("connect", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
        connectCount += 1;
        const [host, portText] = (req.url ?? "").split(":");
        const serverSocket = netConnect(Number(portText), host, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        });
      });
      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const proxyAddress = proxy.address();
      if (proxyAddress === null || typeof proxyAddress === "string") {
        throw new Error("Fixture proxy did not bind to a TCP port");
      }
      proxyPort = proxyAddress.port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) => target.close((error) => (error ? reject(error) : resolve())));
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    });

    it("routes the request through the reserved proxy, and releases it on success", async () => {
      const proxyPool = fakeProxyPool({
        reserve: vi.fn(async () => ({ id: "proxy1", host: "127.0.0.1", port: proxyPort })),
      });
      const countBefore = connectCount;

      const result = await httpExecutor(
        node({ url: targetUrl, networkMode: "proxy" }),
        buildContext({ proxyPool }),
      );

      expect((result.output as { status: number }).status).toBe(200);
      expect(connectCount).toBe(countBefore + 1);
      expect(proxyPool.reserve).toHaveBeenCalledOnce();
      expect(proxyPool.release).toHaveBeenCalledWith("proxy1");
      expect(proxyPool.reportError).not.toHaveBeenCalled();
    });

    it("throws a clear error when networkMode is 'proxy' but no proxy pool is wired up", async () => {
      await expect(
        httpExecutor(node({ url: targetUrl, networkMode: "proxy" }), buildContext()),
      ).rejects.toThrow(/no proxy pool/i);
    });

    it("throws a clear error when the pool has nothing available", async () => {
      const proxyPool = fakeProxyPool({ reserve: vi.fn(async () => null) });

      await expect(
        httpExecutor(node({ url: targetUrl, networkMode: "proxy" }), buildContext({ proxyPool })),
      ).rejects.toThrow(/no proxy is currently available/i);
      expect(proxyPool.release).not.toHaveBeenCalled();
    });

    it("reports an error and still releases the proxy when the connection through it fails", async () => {
      const proxyPool = fakeProxyPool({
        // Nothing listens here — a genuine connection failure, not a normal HTTP error response.
        reserve: vi.fn(async () => ({ id: "proxy1", host: "127.0.0.1", port: 1 })),
      });

      await expect(
        httpExecutor(node({ url: targetUrl, networkMode: "proxy" }), buildContext({ proxyPool })),
      ).rejects.toThrow();
      expect(proxyPool.reportError).toHaveBeenCalledWith("proxy1");
      expect(proxyPool.release).toHaveBeenCalledWith("proxy1");
    });

    it("never reports an error for an ordinary non-2xx response — that's the target's answer, not the proxy's fault", async () => {
      target.removeAllListeners("request");
      target.on("request", (_req, res) => {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      });
      const proxyPool = fakeProxyPool({
        reserve: vi.fn(async () => ({ id: "proxy1", host: "127.0.0.1", port: proxyPort })),
      });

      const result = await httpExecutor(
        node({ url: targetUrl, networkMode: "proxy" }),
        buildContext({ proxyPool }),
      );

      expect((result.output as { status: number }).status).toBe(404);
      expect(proxyPool.reportError).not.toHaveBeenCalled();
      expect(proxyPool.release).toHaveBeenCalledWith("proxy1");
    });
  });
});
