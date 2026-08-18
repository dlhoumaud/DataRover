/**
 * Payload of a job enqueued on the {@link EXECUTION_QUEUE_NAME} queue.
 *
 * Kept intentionally minimal: the job only carries the id of the execution
 * to run, the worker is responsible for loading the rest of the state.
 */
export interface ExecutionJobData {
  executionId: string;
}

/**
 * Connection options for the Redis instance backing the BullMQ queue.
 *
 * Mirrors the subset of `ioredis`/`bullmq` connection options this
 * monorepo relies on, without depending on either package.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
}
