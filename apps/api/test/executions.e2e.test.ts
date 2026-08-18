import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Queue } from "bullmq";
import {
  EXECUTION_QUEUE_NAME,
  getRedisConnectionOptions,
  type ExecutionJobData,
} from "@datarover/queue";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

interface ExecutionResponse {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: string;
}

interface ExecutionWithLogsResponse extends ExecutionResponse {
  logs: unknown[];
}

function stopOnlyDefinition(name: string) {
  return {
    name,
    startNodeId: "stop-1",
    nodes: [{ id: "stop-1", name: "Stop", type: "stop" as const }],
    edges: [],
  };
}

describe("Executions", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let queue: Queue<ExecutionJobData>;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    prisma = app.get(PrismaService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // Independent BullMQ Queue client pointed at the same Redis connection
    // as ExecutionQueueService, used only to observe job counts — this test
    // never runs a worker/processor.
    queue = new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
    });
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
    await queue.close();
    await app.close();
  });

  async function createWorkflow(): Promise<string> {
    const projectResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/projects",
      payload: { name: `e2e-execution-project-${randomUUID()}` },
    });
    const project = JSON.parse(projectResponse.payload) as { id: string };
    createdProjectIds.push(project.id);

    const workflowResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/projects/${project.id}/workflows`,
      payload: {
        name: "Stop workflow",
        definition: stopOnlyDefinition("Stop workflow"),
      },
    });
    const workflow = JSON.parse(workflowResponse.payload) as { id: string };
    return workflow.id;
  }

  it("enqueues a job and creates a pending execution (does not run the engine)", async () => {
    const workflowId = await createWorkflow();

    const countsBefore = await queue.getJobCounts();
    const totalBefore =
      (countsBefore.waiting ?? 0) + (countsBefore.active ?? 0) + (countsBefore.delayed ?? 0);

    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/executions`,
    });
    expect(createResponse.statusCode).toBe(202);
    const created = JSON.parse(createResponse.payload) as ExecutionResponse;
    expect(created.status).toBe("pending");
    expect(created.workflowId).toBe(workflowId);

    const countsAfter = await queue.getJobCounts();
    const totalAfter =
      (countsAfter.waiting ?? 0) + (countsAfter.active ?? 0) + (countsAfter.delayed ?? 0);
    expect(totalAfter).toBeGreaterThan(totalBefore);

    const getResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/executions/${created.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.payload) as ExecutionWithLogsResponse;
    expect(fetched.id).toBe(created.id);
    expect(fetched.status).toBe("pending");
    expect(Array.isArray(fetched.logs)).toBe(true);

    const listResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/workflows/${workflowId}/executions`,
    });
    expect(listResponse.statusCode).toBe(200);
    const list = JSON.parse(listResponse.payload) as ExecutionResponse[];
    expect(list.some((execution) => execution.id === created.id)).toBe(true);
  });

  it("returns 404 for a non-existent execution id", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/executions/does-not-exist",
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 when triggering an execution for a non-existent workflow", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/workflows/does-not-exist/executions",
    });
    expect(response.statusCode).toBe(404);
  });
});
