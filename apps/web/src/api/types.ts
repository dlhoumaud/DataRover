import type { ActionResult, ExecutionStatus, WorkflowDefinition } from "@datarover/workflow-types";

/**
 * HTTP response DTOs, as actually returned by the NestJS API — these are
 * distinct from the Zod schemas exported by @datarover/workflow-types
 * (which model the execution engine's internal domain objects). The API
 * layer adds persistence fields (`id`, `createdAt`, `workflowVersionId`, ...)
 * on top of / instead of those internal shapes, so do not conflate the two.
 */

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  variables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummaryDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: number;
}

export interface WorkflowVersionDto {
  version: number;
  definition: WorkflowDefinition;
  createdAt: string;
}

export interface WorkflowDetailDto {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: WorkflowVersionDto;
}

export interface ExecutionSummaryDto {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: ExecutionStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  actionResults: ActionResult[];
  createdAt: string;
}

export interface ExecutionLogDto {
  id: string;
  executionId: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  nodeId: string | null;
}

export interface ExecutionDetailDto extends ExecutionSummaryDto {
  logs: ExecutionLogDto[];
}

export interface HealthDto {
  status: "ok" | "degraded";
  db: "ok" | "error";
  redis: "ok" | "error";
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  variables?: Record<string, unknown>;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export interface CreateWorkflowInput {
  name: string;
  definition: Omit<WorkflowDefinition, "id">;
}

export interface UpdateWorkflowInput {
  name?: string;
  definition?: Omit<WorkflowDefinition, "id">;
}

/**
 * Execution statuses considered final — an execution in one of these states
 * will never transition again. Reused by useExecution's polling logic to
 * stop refetching once an execution has settled.
 */
export const TERMINAL_EXECUTION_STATUSES: ExecutionStatus[] = ["success", "failed", "cancelled"];
