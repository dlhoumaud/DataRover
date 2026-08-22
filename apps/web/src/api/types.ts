import type {
  ActionResult,
  ExecutionStatus,
  ExtractOutputType,
  ExtractSourceType,
  HttpMethod,
  ScheduleType,
  WorkflowDefinition,
} from "@datarover/workflow-types";

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

/**
 * DTOs for the "Prévisualiser & sélectionner" tool (Specs.md §6/§8),
 * backed by POST /tools/preview-html and POST /tools/test-selector — see
 * src/api/tools.ts.
 */

export interface PreviewHtmlInput {
  projectId: string;
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
  /**
   * Renders the page in a real headless browser server-side instead of a plain fetch — for
   * targets whose actual content only exists after client-side JS runs. Slower; GET-only.
   */
  render?: boolean;
}

export interface PreviewHtmlResultDto {
  status: number;
  html: string;
  url: string;
}

export interface SelectorScoreDto {
  selector: string;
  score: number;
  matched: boolean;
}

export interface TestSelectorInput {
  source: string;
  sourceType?: ExtractSourceType;
  selectors: string[];
  output?: ExtractOutputType;
  attribute?: string;
}

export interface TestSelectorResultDto {
  name: string;
  value: unknown;
  matchedSelector?: string;
  selectorScores: SelectorScoreDto[];
}

/**
 * DTOs for the scheduler (Specs.md §14), backed by
 * POST/GET /workflows/:workflowId/schedules and PATCH/DELETE /schedules/:id — see
 * src/api/schedules.ts.
 */

export interface ScheduleDto {
  id: string;
  workflowId: string;
  type: ScheduleType;
  everyMinutes: number | null;
  cronExpression: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  type: ScheduleType;
  everyMinutes?: number;
  cronExpression?: string;
  enabled?: boolean;
}

/**
 * DTOs for the global proxy pool, backed by GET/POST/PATCH/DELETE /proxies and GET/PATCH
 * /proxies/config — see src/api/proxies.ts. Not project-scoped, unlike everything else above.
 */

/** Hand-typed rather than imported from `@datarover/database` (the Prisma-generated enum) — this
 *  app never depends on that package, exactly like `ExecutionLogDto.level` above is hand-typed
 *  rather than imported from wherever the API happens to define it. */
export type ProxyStatus = "active" | "disabled";

export interface ProxyDto {
  id: string;
  host: string;
  port: number;
  status: ProxyStatus;
  errorCount: number;
  isInUse: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyListDto {
  items: ProxyDto[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateProxyInput {
  host: string;
  port: number;
}

export interface UpdateProxyInput {
  host?: string;
  port?: number;
  status?: ProxyStatus;
}

export interface ProxyConfigDto {
  purgeErrorThreshold: number;
}

export type UpdateProxyConfigInput = ProxyConfigDto;
