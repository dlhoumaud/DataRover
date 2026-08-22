import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { connect as netConnect } from "node:net";
import type { Socket } from "node:net";

import { disconnectPrismaClient, getPrismaClient } from "@datarover/database";
import type { Prisma } from "@datarover/database";
import type { WorkflowDefinition } from "@datarover/workflow-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processExecutionJob } from "./processExecutionJob.js";

const prisma = getPrismaClient();

/** Builds a minimal two-node (`http` -> `stop`) workflow targeting `url`. */
function buildDefinition(url: string, networkMode: "direct" | "proxy" = "direct"): WorkflowDefinition {
  return {
    id: `wf-${randomUUID()}`,
    name: "Ping workflow",
    startNodeId: "ping",
    nodes: [
      {
        id: "ping",
        name: "Ping the fixture server",
        type: "http",
        method: "GET",
        url,
        responseType: "json",
        networkMode,
        timeoutMs: 2000,
      },
      {
        id: "stop",
        name: "Stop",
        type: "stop",
      },
    ],
    edges: [{ from: "ping", to: "stop" }],
  };
}

describe("processExecutionJob integration", () => {
  let server: Server;
  let baseUrl: string;
  let projectId: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Failed to determine the fixture server's ephemeral port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;

    const project = await prisma.project.create({
      data: {
        name: `worker-test-project-${randomUUID()}`,
        variables: { baseUrl },
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    // Cascades to every Workflow / WorkflowVersion / Execution / ExecutionLog
    // created against this project (see schema.prisma onDelete: Cascade).
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    await disconnectPrismaClient();
  });

  it("executes a two-node workflow successfully and persists results and logs", async () => {
    const workflow = await prisma.workflow.create({
      data: { projectId, name: `ping-workflow-${randomUUID()}` },
    });
    const workflowVersion = await prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        definition: buildDefinition("{{ global.baseUrl }}/ping") as unknown as Prisma.InputJsonValue,
      },
    });
    const execution = await prisma.execution.create({
      data: {
        workflowId: workflow.id,
        workflowVersionId: workflowVersion.id,
        status: "pending",
      },
    });

    await processExecutionJob({ executionId: execution.id });

    const reloaded = await prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(reloaded.status).toBe("success");
    expect(reloaded.finishedAt).not.toBeNull();
    expect(reloaded.error).toBeNull();

    const actionResults = reloaded.actionResults as unknown as Array<{
      nodeId: string;
      status: string;
    }>;
    expect(actionResults).toHaveLength(2);
    for (const result of actionResults) {
      expect(result.status).toBe("success");
    }

    const logs = await prisma.executionLog.findMany({ where: { executionId: execution.id } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    const nodeIdsWithLogs = new Set(
      logs.map((log) => log.nodeId).filter((nodeId): nodeId is string => nodeId !== null),
    );
    expect(nodeIdsWithLogs.has("ping")).toBe(true);
    expect(nodeIdsWithLogs.has("stop")).toBe(true);
  });

  it("marks the execution failed without throwing on an unreachable target", async () => {
    const workflow = await prisma.workflow.create({
      data: { projectId, name: `unreachable-workflow-${randomUUID()}` },
    });
    const workflowVersion = await prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        // Port 1 is a privileged port nothing listens on in test environments:
        // the connection is refused quickly instead of timing out.
        definition: buildDefinition("http://localhost:1/ping") as unknown as Prisma.InputJsonValue,
      },
    });
    const execution = await prisma.execution.create({
      data: {
        workflowId: workflow.id,
        workflowVersionId: workflowVersion.id,
        status: "pending",
      },
    });

    await expect(processExecutionJob({ executionId: execution.id })).resolves.toBeUndefined();

    const reloaded = await prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(reloaded.status).toBe("failed");
    expect(reloaded.finishedAt).not.toBeNull();
    expect(reloaded.error).toBeTruthy();
  });

  describe("networkMode: 'proxy' — full wiring through a real Proxy row", () => {
    let proxy: Server;
    let proxyPort: number;

    beforeAll(async () => {
      // Same real CONNECT-tunnel proxy as httpExecutor.test.ts — undici's `ProxyAgent` (what
      // `httpExecutor` actually uses) tunnels by default regardless of target scheme.
      proxy = createServer();
      proxy.on("connect", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
        const [host, portText] = (req.url ?? "").split(":");
        const serverSocket = netConnect(Number(portText), host, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          serverSocket.write(head);
          serverSocket.pipe(clientSocket);
          clientSocket.pipe(serverSocket);
        });
        // The "purges after a real connection failure" test below deliberately points at a port
        // nothing listens on — without this, the tunnel attempt would just hang until undici's
        // own timeout instead of failing promptly and cleanly.
        serverSocket.on("error", () => clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
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
      proxy.closeAllConnections();
      await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
    });

    it("reserves a real Proxy row end to end, uses it, and releases it again on success", async () => {
      const dbProxy = await prisma.proxy.create({
        data: { host: "127.0.0.1", port: proxyPort },
      });

      const workflow = await prisma.workflow.create({
        data: { projectId, name: `proxy-workflow-${randomUUID()}` },
      });
      const workflowVersion = await prisma.workflowVersion.create({
        data: {
          workflowId: workflow.id,
          version: 1,
          definition: buildDefinition("{{ global.baseUrl }}/ping", "proxy") as unknown as Prisma.InputJsonValue,
        },
      });
      const execution = await prisma.execution.create({
        data: { workflowId: workflow.id, workflowVersionId: workflowVersion.id, status: "pending" },
      });

      await processExecutionJob({ executionId: execution.id });

      const reloadedExecution = await prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
      expect(reloadedExecution.status).toBe("success");

      const reloadedProxy = await prisma.proxy.findUniqueOrThrow({ where: { id: dbProxy.id } });
      expect(reloadedProxy.isInUse).toBe(false);
      expect(reloadedProxy.errorCount).toBe(0);

      await prisma.proxy.delete({ where: { id: dbProxy.id } }).catch(() => undefined);
    });

    it("purges the Proxy row once its error count reaches the configured threshold", async () => {
      const config = await prisma.proxyPoolConfig.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
      const dbProxy = await prisma.proxy.create({
        data: { host: "127.0.0.1", port: proxyPort, errorCount: config.purgeErrorThreshold - 1 },
      });

      const workflow = await prisma.workflow.create({
        data: { projectId, name: `proxy-purge-workflow-${randomUUID()}` },
      });
      const workflowVersion = await prisma.workflowVersion.create({
        data: {
          workflowId: workflow.id,
          version: 1,
          // Nothing listens on the fixture's own port through this proxy — a connection reset,
          // not a normal HTTP response, exactly the signal that counts as a proxy error.
          definition: buildDefinition("http://127.0.0.1:1/ping", "proxy") as unknown as Prisma.InputJsonValue,
        },
      });
      const execution = await prisma.execution.create({
        data: { workflowId: workflow.id, workflowVersionId: workflowVersion.id, status: "pending" },
      });

      await expect(processExecutionJob({ executionId: execution.id })).resolves.toBeUndefined();

      const reloadedExecution = await prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
      expect(reloadedExecution.status).toBe("failed");
      expect(await prisma.proxy.findUnique({ where: { id: dbProxy.id } })).toBeNull();
    });
  });
});
