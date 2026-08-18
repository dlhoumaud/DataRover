/**
 * A minimal structured logger interface implemented by every logger in the
 * monorepo.
 */
export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function timestamp(): string {
  const now = new Date();
  const hours = pad2(now.getHours());
  const minutes = pad2(now.getMinutes());
  const seconds = pad2(now.getSeconds());
  return `[${hours}:${minutes}:${seconds}]`;
}

/**
 * Creates a console-backed {@link Logger}.
 *
 * Every emitted line is prefixed with a local-time, zero-padded 24h
 * timestamp (`[HH:MM:SS]`) followed by `[name]`. The `warn` and `error`
 * levels additionally insert the level name in uppercase (`WARN` /
 * `ERROR`) right before the message; `info` and `debug` do not add a
 * level prefix. `info` and `debug` are written via `console.log`, `warn`
 * via `console.warn`, and `error` via `console.error`.
 *
 * @param name - Logical name identifying the logger's owner, included in
 * every line.
 * @returns A {@link Logger} instance writing to the console.
 */
export function createConsoleLogger(name: string): Logger {
  return {
    info(msg: string): void {
      console.log(`${timestamp()} [${name}] ${msg}`);
    },
    debug(msg: string): void {
      console.log(`${timestamp()} [${name}] ${msg}`);
    },
    warn(msg: string): void {
      console.warn(`${timestamp()} [${name}] WARN ${msg}`);
    },
    error(msg: string): void {
      console.error(`${timestamp()} [${name}] ERROR ${msg}`);
    },
  };
}
