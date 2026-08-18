import type { RedisConnectionOptions } from "./types.js";

const DEFAULT_REDIS_HOST = "localhost";
const DEFAULT_REDIS_PORT = 6379;

/**
 * Reads Redis connection options from environment variables.
 *
 * - `REDIS_HOST` — defaults to `"localhost"`.
 * - `REDIS_PORT` — defaults to `6379`; must parse as a valid integer when
 *   provided, otherwise an explicit error is thrown.
 * - `REDIS_PASSWORD` — optional; omitted from the result entirely when not
 *   set (rather than being present with an `undefined` value).
 *
 * @param env - Source of environment variables, defaults to `process.env`.
 *   Passing an explicit object (instead of relying on the global
 *   `process.env`) makes the function easy to unit test without mutating
 *   global state.
 */
export function getRedisConnectionOptions(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionOptions {
  const host = env.REDIS_HOST ?? DEFAULT_REDIS_HOST;

  const rawPort = env.REDIS_PORT;
  let port = DEFAULT_REDIS_PORT;
  if (rawPort !== undefined && rawPort !== "") {
    if (!/^-?\d+$/.test(rawPort.trim())) {
      throw new Error(
        `Invalid REDIS_PORT value: "${rawPort}". Expected an integer.`,
      );
    }
    port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port)) {
      throw new Error(
        `Invalid REDIS_PORT value: "${rawPort}". Expected an integer.`,
      );
    }
  }

  const options: RedisConnectionOptions = { host, port };

  const password = env.REDIS_PASSWORD;
  if (password !== undefined) {
    options.password = password;
  }

  return options;
}
