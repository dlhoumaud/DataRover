import { randomUUID } from "node:crypto";

import { getPrismaClient } from "@datarover/database";
import { EXECUTION_QUEUE_NAME, getRedisConnectionOptions } from "@datarover/queue";
import type { ExecutionJobData, ScheduleTriggerJobData } from "@datarover/queue";
import type { WorkflowDefinition } from "@datarover/workflow-types";
import { Queue, Worker } from "bullmq";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeScheduleTriggerResources, processScheduleTrigger } from "./processScheduleTrigger.js";

const prisma = getPrismaClient();

function stopOnlyDefinition(id: string): WorkflowDefinition {
  return { id, name: "Stop workflow", startNodeId: "stop", nodes: [{ id: "stop", name: "Stop", type: "stop" }], edges: [] };
}

describe("processScheduleTrigger integration", () => {
  let projectId: string;
  // Independent of the module-under-test's own producer queue — reads real Redis state to prove
  // the enqueue actually happened, not just that the function returned without throwing.
  let rawExecutionQueue: Queue<ExecutionJobData>;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: { name: `worker-schedule-test-project-${randomUUID()}` },
    });
    projectId = project.id;
    rawExecutionQueue = new Queue<ExecutionJobData>(EXECUTION_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
    });
  });

  afterEach(async () => {
    // Drain whatever this test enqueued so it doesn't linger and get picked up by a real worker
    // process that happens to be running against the same Redis instance.
    const jobs = await rawExecutionQueue.getJobs(["waiting", "delayed", "active"]);
    await Promise.all(jobs.map((job) => job.remove().catch(() => undefined)));
  });

  afterAll(async () => {
    // Cascades to every Workflow / WorkflowVersion / Execution / Schedule created against this
    // project (see schema.prisma onDelete: Cascade).
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await rawExecutionQueue.close();
    await closeScheduleTriggerResources();
  });

  async function createWorkflowWithVersion(): Promise<string> {
    const workflow = await prisma.workflow.create({ data: { projectId, name: "Scheduled workflow" } });
    await prisma.workflowVersion.create({
      data: { workflowId: workflow.id, version: 1, definition: stopOnlyDefinition(workflow.id) as object },
    });
    return workflow.id;
  }

  async function findEnqueuedExecutionId(): Promise<string | undefined> {
    const jobs = await rawExecutionQueue.getJobs(["waiting", "delayed", "active"]);
    return jobs.find((job) => job.data.executionId !== undefined)?.data.executionId;
  }

  it("creates a pending execution and enqueues it, for an enabled schedule on a workflow with a version", async () => {
    const workflowId = await createWorkflowWithVersion();
    const schedule = await prisma.schedule.create({
      data: { workflowId, type: "hourly", enabled: true },
    });

    await processScheduleTrigger({ scheduleId: schedule.id, workflowId });

    const executions = await prisma.execution.findMany({ where: { workflowId } });
    expect(executions).toHaveLength(1);
    expect(executions[0]?.status).toBe("pending");

    const enqueuedId = await findEnqueuedExecutionId();
    expect(enqueuedId).toBe(executions[0]?.id);
  });

  it("skips quietly (no execution created) when the schedule is disabled", async () => {
    const workflowId = await createWorkflowWithVersion();
    const schedule = await prisma.schedule.create({
      data: { workflowId, type: "hourly", enabled: false },
    });

    await expect(processScheduleTrigger({ scheduleId: schedule.id, workflowId })).resolves.toBeUndefined();

    expect(await prisma.execution.count({ where: { workflowId } })).toBe(0);
  });

  it("skips quietly when the schedule no longer exists (deleted after the tick was queued)", async () => {
    const workflowId = await createWorkflowWithVersion();

    await expect(
      processScheduleTrigger({ scheduleId: `does-not-exist-${randomUUID()}`, workflowId }),
    ).resolves.toBeUndefined();

    expect(await prisma.execution.count({ where: { workflowId } })).toBe(0);
  });

  it("skips (logs, does not throw) when the workflow has no versions yet", async () => {
    const workflow = await prisma.workflow.create({ data: { projectId, name: "Versionless workflow" } });
    const schedule = await prisma.schedule.create({
      data: { workflowId: workflow.id, type: "hourly", enabled: true },
    });

    await expect(
      processScheduleTrigger({ scheduleId: schedule.id, workflowId: workflow.id }),
    ).resolves.toBeUndefined();

    expect(await prisma.execution.count({ where: { workflowId: workflow.id } })).toBe(0);
  });

  it("fires for real: a live BullMQ job scheduler ticking every 2s is picked up by a real Worker running processScheduleTrigger", async () => {
    const workflowId = await createWorkflowWithVersion();
    const schedule = await prisma.schedule.create({
      data: { workflowId, type: "interval", everyMinutes: 1, enabled: true },
    });

    // A throwaway queue name, not SCHEDULE_TRIGGER_QUEUE_NAME: a real apps/worker dev process
    // (this repo's own, running against the same Redis for local development) would otherwise
    // compete with this test's Worker for the very same job — BullMQ delivers each job to exactly
    // one consumer, so whichever process wins leaves the other's listeners hanging. The function
    // under test (processScheduleTrigger) only ever reads its argument, so which queue name
    // *delivered* the job is irrelevant to it — only that a real BullMQ tick did.
    //
    // Also bypasses the API's 1-minute DTO minimum on purpose — this test's only job is to prove
    // the real tick -> processScheduleTrigger -> real Execution pipeline fires end to end, not to
    // wait out a real minute; apps/api/test/schedules.e2e.test.ts already proves the API registers
    // the *right* repeat options (including real 1-minute-granularity intervals).
    const isolatedQueueName = `test-schedule-triggers-${randomUUID()}`;
    const triggerQueue = new Queue<ScheduleTriggerJobData>(isolatedQueueName, {
      connection: getRedisConnectionOptions(),
    });
    const triggerWorker = new Worker<ScheduleTriggerJobData>(
      isolatedQueueName,
      (job) => processScheduleTrigger(job.data),
      { connection: getRedisConnectionOptions() },
    );

    try {
      await triggerQueue.upsertJobScheduler(
        schedule.id,
        { every: 2000, limit: 1 },
        { name: "trigger", data: { scheduleId: schedule.id, workflowId } },
      );

      await new Promise<void>((resolve, reject) => {
        triggerWorker.on("completed", () => resolve());
        triggerWorker.on("failed", (_job, error) => reject(error));
        setTimeout(() => reject(new Error("job scheduler never fired within 8s")), 8000);
      });

      const executions = await prisma.execution.findMany({ where: { workflowId } });
      expect(executions).toHaveLength(1);
      expect(executions[0]?.status).toBe("pending");
    } finally {
      await triggerWorker.close();
      await triggerQueue.removeJobScheduler(schedule.id);
      await triggerQueue.close();
    }
  }, 15_000);
});
