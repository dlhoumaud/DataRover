/**
 * Name of the BullMQ queue used to dispatch workflow execution jobs.
 *
 * Shared between apps/api (producer) and apps/worker (consumer) so both
 * sides always agree on the queue they are talking about.
 */
export const EXECUTION_QUEUE_NAME = "workflow-executions" as const;
