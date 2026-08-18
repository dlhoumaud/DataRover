import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { disconnectPrismaClient, getPrismaClient } from "@datarover/database";
import type { Prisma } from "@datarover/database";
import type { WorkflowDefinition } from "@datarover/workflow-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processExecutionJob } from "./processExecutionJob.js";

const prisma = getPrismaClient();

/** Builds a minimal two-node (`http` -> `stop`) workflow targeting `url`. */
function buildDefinition(url: string): WorkflowDefinition {
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
});
