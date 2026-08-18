/**
 * Events emitted by {@link WorkflowEngine.run} as an execution progresses,
 * surfaced through `RunOptions.onEvent`. Every event is also mirrored into
 * the returned `Execution.logs` array, so `onEvent` is purely an
 * observability hook and never the sole source of truth.
 */
export type ExecutionEvent =
  | { type: "started"; executionId: string; workflowId: string }
  | { type: "action-started"; nodeId: string; nodeName: string }
  | { type: "action-completed"; nodeId: string; output: unknown; durationMs: number }
  | { type: "action-failed"; nodeId: string; error: string }
  | { type: "completed"; status: "success" | "failed"; durationMs: number };
