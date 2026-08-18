import { describe, expect, it } from "vitest";
import {
  ActionResultSchema,
  ExecutionLogEntrySchema,
  ExecutionSchema,
  ExecutionStatus,
} from "./execution";

describe("ExecutionStatus", () => {
  it("accepts all known statuses", () => {
    for (const status of ["pending", "running", "success", "failed", "cancelled", "retrying"]) {
      expect(ExecutionStatus.safeParse(status).success).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(ExecutionStatus.safeParse("paused").success).toBe(false);
  });
});

describe("ActionResultSchema", () => {
  it("parses a minimal action result and applies defaults", () => {
    const result = ActionResultSchema.parse({
      nodeId: "n1",
      status: "success",
      startedAt: "2026-08-18T00:00:00.000Z",
    });
    expect(result.attempts).toBe(0);
    expect(result.finishedAt).toBeUndefined();
  });
});

describe("ExecutionLogEntrySchema", () => {
  it("parses a minimal log entry", () => {
    const result = ExecutionLogEntrySchema.parse({
      timestamp: "2026-08-18T00:00:00.000Z",
      level: "info",
      message: "Starting execution",
    });
    expect(result.nodeId).toBeUndefined();
  });

  it("rejects an invalid log level", () => {
    const result = ExecutionLogEntrySchema.safeParse({
      timestamp: "2026-08-18T00:00:00.000Z",
      level: "critical",
      message: "oops",
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionSchema", () => {
  it("validates a minimal execution object and fills in defaults", () => {
    const result = ExecutionSchema.parse({
      id: "exec-1",
      workflowId: "wf-1",
      status: "pending",
      startedAt: "2026-08-18T00:00:00.000Z",
    });

    expect(result.actionResults).toEqual([]);
    expect(result.logs).toEqual([]);
    expect(result.finishedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("parses a fully populated execution object", () => {
    const result = ExecutionSchema.parse({
      id: "exec-1",
      workflowId: "wf-1",
      status: "failed",
      startedAt: "2026-08-18T00:00:00.000Z",
      finishedAt: "2026-08-18T00:05:00.000Z",
      actionResults: [
        {
          nodeId: "n1",
          status: "failed",
          startedAt: "2026-08-18T00:00:00.000Z",
          finishedAt: "2026-08-18T00:01:00.000Z",
          error: "timeout",
          attempts: 3,
        },
      ],
      logs: [
        {
          timestamp: "2026-08-18T00:00:01.000Z",
          level: "error",
          message: "Request timed out",
          nodeId: "n1",
        },
      ],
      error: "workflow failed",
    });

    expect(result.actionResults).toHaveLength(1);
    expect(result.logs).toHaveLength(1);
    expect(result.error).toBe("workflow failed");
  });

  it("rejects an execution object missing required fields", () => {
    const result = ExecutionSchema.safeParse({ id: "exec-1", workflowId: "wf-1" });
    expect(result.success).toBe(false);
  });
});
