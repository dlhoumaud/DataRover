/**
 * The data made available to templates and expressions while a workflow
 * runs. Every top-level slot is optional so a partial context (e.g. only
 * `item`, while previewing a single iteration) can still be resolved
 * against without throwing.
 */
export interface ExpressionContext {
  global?: Record<string, unknown>;
  project?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  actions?: Record<string, { output?: unknown }>;
  item?: unknown;
  runtime?: Record<string, unknown>;
}

type PathSegment = { kind: "key"; key: string } | { kind: "index"; index: number };

/**
 * Key segments that are always resolved as `undefined` rather than
 * followed, regardless of what the context actually contains. Every
 * plain JavaScript object exposes `constructor`, `prototype`, and
 * `__proto__` through its prototype chain; without this guard a path
 * such as `"global.constructor.constructor"` would resolve to the
 * `Function` constructor and hand a caller a live code-execution
 * primitive purely by walking property access — never through this
 * module's own tokenizer/parser/evaluator, but a real risk for whatever
 * later reads the resolved value. Blocking these keys keeps every
 * resolution confined to plain data.
 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Matches a full dotted/indexed path such as `global.baseUrl` or
 * `actions.extract.output.prices[0]`. Group 1 is the leading identifier,
 * group 2 is the (possibly empty) sequence of `.identifier` / `[digits]`
 * segments that follow it.
 */
const PATH_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)$/;

const TAIL_SEGMENT_PATTERN = /\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;

/**
 * Parses a dotted-path string into a sequence of key/index segments.
 * Returns `undefined` when `path` is not a well-formed path rather than
 * throwing, so callers can treat malformed input the same way as a
 * missing value.
 */
function parsePathSegments(path: string): PathSegment[] | undefined {
  const match = PATH_PATTERN.exec(path);
  if (match === null) {
    return undefined;
  }

  const head = match[1];
  if (head === undefined) {
    return undefined;
  }

  const segments: PathSegment[] = [{ kind: "key", key: head }];
  const rest = match[2] ?? "";

  TAIL_SEGMENT_PATTERN.lastIndex = 0;
  let tailMatch: RegExpExecArray | null;
  while ((tailMatch = TAIL_SEGMENT_PATTERN.exec(rest)) !== null) {
    const key = tailMatch[1];
    const index = tailMatch[2];
    if (key !== undefined) {
      segments.push({ kind: "key", key });
    } else if (index !== undefined) {
      segments.push({ kind: "index", index: Number(index) });
    }
  }

  return segments;
}

/**
 * Resolves a dotted path (with optional array indices) against an
 * {@link ExpressionContext}, e.g. `"global.baseUrl"`,
 * `"actions.login.output.token"`, `"item.price"`, or
 * `"actions.extract.output.prices[0]"`.
 *
 * Never throws for a missing or malformed path: any segment that cannot
 * be resolved (an undefined/null intermediate value, an out-of-range
 * index, indexing into a non-array, or an unparseable path string)
 * simply produces `undefined`. Prototype-chain keys (`constructor`,
 * `prototype`, `__proto__`) are always treated as unresolved, see
 * {@link FORBIDDEN_KEYS}.
 */
export function resolvePath(context: ExpressionContext, path: string): unknown {
  const segments = parsePathSegments(path);
  if (segments === undefined) {
    return undefined;
  }

  let current: unknown = context;
  for (const segment of segments) {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (segment.kind === "index") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = (current as unknown[])[segment.index];
    } else {
      if (typeof current !== "object") {
        return undefined;
      }
      if (FORBIDDEN_KEYS.has(segment.key)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment.key];
    }
  }

  return current;
}
