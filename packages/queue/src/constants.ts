/**
 * Name of the BullMQ queue used to dispatch workflow execution jobs.
 *
 * Shared between apps/api (producer) and apps/worker (consumer) so both
 * sides always agree on the queue they are talking about.
 */
export const EXECUTION_QUEUE_NAME = "workflow-executions" as const;

/**
 * Name of the BullMQ queue backing recurring `Schedule` triggers (Specs.md §14). apps/api
 * registers one BullMQ *job scheduler* per enabled, non-`manual` `Schedule` row (keyed by the
 * schedule's own id, via `Queue.upsertJobScheduler`) on this queue; apps/worker consumes the jobs
 * it produces and turns each tick into a brand new `Execution`, then enqueues that onto
 * {@link EXECUTION_QUEUE_NAME} — the exact same path a manual "Exécuter" click takes. Kept
 * separate from `EXECUTION_QUEUE_NAME` because the two job shapes are unrelated: a schedule tick
 * doesn't have an `Execution` yet (see {@link ScheduleTriggerJobData}), while every job on
 * `EXECUTION_QUEUE_NAME` names one that already exists.
 */
export const SCHEDULE_TRIGGER_QUEUE_NAME = "workflow-schedule-triggers" as const;
