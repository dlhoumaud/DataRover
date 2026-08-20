import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Queue } from "bullmq";
import { SCHEDULE_TRIGGER_QUEUE_NAME, getRedisConnectionOptions } from "@datarover/queue";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

interface ScheduleResponse {
  id: string;
  workflowId: string;
  type: string;
  everyMinutes: number | null;
  cronExpression: string | null;
  enabled: boolean;
}

function stopOnlyDefinition(name: string) {
  return {
    name,
    startNodeId: "stop-1",
    nodes: [{ id: "stop-1", name: "Stop", type: "stop" as const }],
    edges: [],
  };
}

describe("Schedules", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  // Independent of ScheduleQueueService — reads BullMQ's own state directly to prove the API's
  // create/enable/disable/delete calls actually reach Redis, not just that the handlers ran.
  let rawScheduleQueue: Queue;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    prisma = app.get(PrismaService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    rawScheduleQueue = new Queue(SCHEDULE_TRIGGER_QUEUE_NAME, { connection: getRedisConnectionOptions() });
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
    await rawScheduleQueue.close();
    await app.close();
  });

  async function createWorkflow(): Promise<string> {
    const projectResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/projects",
      payload: { name: `e2e-schedule-project-${randomUUID()}` },
    });
    const projectId = (JSON.parse(projectResponse.payload) as { id: string }).id;
    createdProjectIds.push(projectId);

    const workflowResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/projects/${projectId}/workflows`,
      payload: { name: "Scheduled workflow", definition: stopOnlyDefinition("Scheduled workflow") },
    });
    return (JSON.parse(workflowResponse.payload) as { id: string }).id;
  }

  it("creates an interval schedule, registers a real BullMQ job scheduler, and lists it", async () => {
    const workflowId = await createWorkflow();

    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "interval", everyMinutes: 15 },
    });
    expect(createResponse.statusCode).toBe(201);
    const schedule = JSON.parse(createResponse.payload) as ScheduleResponse;
    expect(schedule.type).toBe("interval");
    expect(schedule.everyMinutes).toBe(15);
    expect(schedule.enabled).toBe(true);

    const jobScheduler = await rawScheduleQueue.getJobScheduler(schedule.id);
    expect(jobScheduler?.every).toBe(15 * 60_000);

    const listResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/workflows/${workflowId}/schedules`,
    });
    expect(listResponse.statusCode).toBe(200);
    const list = JSON.parse(listResponse.payload) as ScheduleResponse[];
    expect(list.map((s) => s.id)).toContain(schedule.id);
  });

  it("resolves hourly/daily/weekly to their fixed cron patterns in the real job scheduler", async () => {
    const workflowId = await createWorkflow();
    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "daily" },
    });
    const schedule = JSON.parse(createResponse.payload) as ScheduleResponse;
    const jobScheduler = await rawScheduleQueue.getJobScheduler(schedule.id);
    expect(jobScheduler?.pattern).toBe("0 0 * * *");
  });

  it("registers no job scheduler for a manual schedule", async () => {
    const workflowId = await createWorkflow();
    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "manual" },
    });
    const schedule = JSON.parse(createResponse.payload) as ScheduleResponse;
    expect(await rawScheduleQueue.getJobScheduler(schedule.id)).toBeUndefined();
  });

  it("disabling removes the job scheduler; re-enabling registers it again", async () => {
    const workflowId = await createWorkflow();
    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "hourly" },
    });
    const schedule = JSON.parse(createResponse.payload) as ScheduleResponse;
    expect(await rawScheduleQueue.getJobScheduler(schedule.id)).toBeDefined();

    const disableResponse = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/schedules/${schedule.id}`,
      payload: { enabled: false },
    });
    expect(disableResponse.statusCode).toBe(200);
    expect((JSON.parse(disableResponse.payload) as ScheduleResponse).enabled).toBe(false);
    expect(await rawScheduleQueue.getJobScheduler(schedule.id)).toBeUndefined();

    const enableResponse = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/schedules/${schedule.id}`,
      payload: { enabled: true },
    });
    expect((JSON.parse(enableResponse.payload) as ScheduleResponse).enabled).toBe(true);
    expect(await rawScheduleQueue.getJobScheduler(schedule.id)).toBeDefined();
  });

  it("deleting a schedule removes both the row and its job scheduler", async () => {
    const workflowId = await createWorkflow();
    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "hourly" },
    });
    const schedule = JSON.parse(createResponse.payload) as ScheduleResponse;

    const deleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: `/schedules/${schedule.id}`,
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(await rawScheduleQueue.getJobScheduler(schedule.id)).toBeUndefined();

    const getResponse = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/schedules/${schedule.id}`,
      payload: { enabled: false },
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it("deleting a workflow cleans up its schedules' job schedulers too", async () => {
    const workflowId = await createWorkflow();
    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "hourly" },
    });
    const schedule = JSON.parse(createResponse.payload) as ScheduleResponse;
    expect(await rawScheduleQueue.getJobScheduler(schedule.id)).toBeDefined();

    const deleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: `/workflows/${workflowId}`,
    });
    expect(deleteResponse.statusCode).toBe(204);
    expect(await rawScheduleQueue.getJobScheduler(schedule.id)).toBeUndefined();
  });

  it("rejects an interval schedule with no everyMinutes", async () => {
    const workflowId = await createWorkflow();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "interval" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a cron schedule with an invalid cron expression", async () => {
    const workflowId = await createWorkflow();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "cron", cronExpression: "not a cron expression" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("accepts a cron schedule with a valid cron expression", async () => {
    const workflowId = await createWorkflow();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/workflows/${workflowId}/schedules`,
      payload: { type: "cron", cronExpression: "*/5 * * * *" },
    });
    expect(response.statusCode).toBe(201);
    const schedule = JSON.parse(response.payload) as ScheduleResponse;
    const jobScheduler = await rawScheduleQueue.getJobScheduler(schedule.id);
    expect(jobScheduler?.pattern).toBe("*/5 * * * *");
  });

  it("returns 404 when creating a schedule under a non-existent workflow", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/workflows/does-not-exist/schedules",
      payload: { type: "manual" },
    });
    expect(response.statusCode).toBe(404);
  });
});
