import { interpolate } from "@datarover/expression-engine";
import type { BrowserActionNode, BrowserActionStep } from "@datarover/workflow-types";
import { request } from "undici";
import type {
  NodeExecutionContext,
  NodeExecutionResult,
  NodeExecutor,
  ProxyPoolClient,
  ReservedProxy,
} from "./types.js";

/** Generous but bounded — a multi-step interactive sequence (several navigations/waits) needs
 *  real time; matches this node's own suggested default `timeoutMs` (see workflowGraph.ts's
 *  createDefaultNode), plus headroom for the HTTP round trip to browser-worker itself. */
const BROWSER_ACTION_REQUEST_TIMEOUT_MS = 35_000;

interface SessionRunResponse {
  status: number;
  html: string;
}

/** Every string-bearing field of a step that can carry a `{{ }}` template, interpolated the same
 *  way `httpExecutor.ts` interpolates `url`/`headers`/`body`. Not a generic deep-interpolate over
 *  the whole step object: several fields (`ms`, `x`, `y`, `delay`) are plain numbers (or a plain
 *  `DelaySpec`, itself all numbers) with no templating story, and `type` must stay a literal for
 *  the discriminated union to survive a round trip through browser-worker. */
function interpolateStep(
  step: BrowserActionStep,
  expressionContext: ReturnType<NodeExecutionContext["expressionContext"]>,
): BrowserActionStep {
  const text = (value: string): string => {
    const result = interpolate(value, expressionContext);
    return typeof result === "string" ? result : String(result);
  };

  switch (step.type) {
    case "navigate":
      return { ...step, url: text(step.url) };
    case "click":
    case "hover":
    case "scrollIntoView":
    case "waitForSelector":
      return { ...step, selector: text(step.selector) };
    case "type":
      return { ...step, selector: text(step.selector), text: text(step.text) };
    case "press":
      return { ...step, key: text(step.key) };
    case "select":
      return { ...step, selector: text(step.selector), value: text(step.value) };
    case "dragTo":
      return { ...step, sourceSelector: text(step.sourceSelector), targetSelector: text(step.targetSelector) };
    case "scrollPage":
    case "wait":
    case "moveMouse":
    case "moveMouseRandom":
      // Purely numeric fields (`x`/`y`/`ms`/`delay`) — nothing to interpolate.
      return step;
    default: {
      const exhaustiveCheck: never = step;
      throw new Error(`Unsupported browserAction step: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Executor for `browserAction` nodes.
 *
 * Interpolates `node.startUrl` and every templated field of `node.steps` (same `{{ }}` convention
 * as `httpExecutor.ts`), then makes a single batch call to `apps/browser-worker`'s
 * `POST /session/run` — this executor never touches Playwright itself, exactly like `httpExecutor`
 * never touches a browser: the actual browser automation is entirely isolated in the
 * `browser-worker` process (see that service's `session.service.ts` for why). `BROWSER_WORKER_URL`
 * defaults to `http://localhost:3002` (plain local dev); in Docker it's the service's own name on
 * the compose network (see docker-compose.yml).
 *
 * `node.networkMode === "proxy"` reserves one proxy from `ctx.proxyPool` and forwards its
 * `host`/`port` to browser-worker as an extra `proxy` field on the same request, released in a
 * `finally` regardless of outcome. Unlike `httpExecutor`, there's no clean way from here to tell
 * "the proxy was unreachable" apart from "the target site itself was unreachable/misbehaved" —
 * browser-worker's Playwright navigation surfaces both as the same generic non-2xx response — so
 * a failed request through this path always counts against the proxy's error count, a deliberate,
 * documented simplification (see ARCHITECTURE.md) rather than a false precision this executor
 * can't actually deliver. A failure to reach browser-worker *at all* is not counted: that's an
 * infra problem with browser-worker itself, unrelated to which proxy (if any) was chosen.
 */
export const browserActionExecutor: NodeExecutor<BrowserActionNode> = async (
  node: BrowserActionNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  const expressionContext = ctx.expressionContext();

  const interpolatedStartUrl = interpolate(node.startUrl, expressionContext);
  const startUrl = typeof interpolatedStartUrl === "string" ? interpolatedStartUrl : String(interpolatedStartUrl);
  const steps = node.steps.map((step) => interpolateStep(step, expressionContext));

  const baseUrl = process.env.BROWSER_WORKER_URL ?? "http://localhost:3002";

  let activeReservation: { pool: ProxyPoolClient; proxy: ReservedProxy } | null = null;
  if (node.networkMode === "proxy") {
    if (!ctx.proxyPool) {
      throw new Error(
        `Node "${node.name}" is set to use a proxy, but no proxy pool is available in this environment.`,
      );
    }
    const proxy = await ctx.proxyPool.reserve();
    if (!proxy) {
      throw new Error(`Node "${node.name}": no proxy is currently available in the pool.`);
    }
    activeReservation = { pool: ctx.proxyPool, proxy };
  }

  try {
    let response;
    try {
      response = await request(`${baseUrl}/session/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startUrl,
          steps,
          ...(activeReservation
            ? { proxy: { host: activeReservation.proxy.host, port: activeReservation.proxy.port } }
            : {}),
        }),
        headersTimeout: BROWSER_ACTION_REQUEST_TIMEOUT_MS,
        bodyTimeout: BROWSER_ACTION_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach the browser-worker service: ${message}`);
    }

    const text = await response.body.text();

    if (response.statusCode >= 400) {
      // browser-worker distinguishes a bad/unreachable target (400) from a genuine internal
      // failure (500), but either way this executor has nothing useful to do except surface it.
      let message = text;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        message = parsed.message ?? text;
      } catch {
        // Not JSON — use the raw body as-is.
      }
      if (activeReservation) {
        await activeReservation.pool.reportError(activeReservation.proxy.id);
      }
      throw new Error(`browserAction "${node.name}" failed: ${message}`);
    }

    const body = JSON.parse(text) as SessionRunResponse;
    return { output: { status: body.status, html: body.html } };
  } finally {
    if (activeReservation) {
      await activeReservation.pool.release(activeReservation.proxy.id);
    }
  }
};
