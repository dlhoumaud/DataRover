import { interpolate } from "@datarover/expression-engine";
import type { HttpNode } from "@datarover/workflow-types";
import { ProxyAgent, request, type Dispatcher } from "undici";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/** Reads `response.body` per `responseType` — the one part of the request that's identical
 *  whether it went out directly or through a reserved proxy. */
async function readResponseBody(
  response: Dispatcher.ResponseData,
  responseType: HttpNode["responseType"],
): Promise<unknown> {
  switch (responseType) {
    case "json": {
      const text = await response.body.text();
      try {
        return text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        return text;
      }
    }
    case "html":
    case "xml":
    case "text":
      return response.body.text();
    case "file":
      return response.body.arrayBuffer();
  }
}

/** `true` for a plain data object (`{}` literal), `false` for arrays, `null`, and everything else. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Stringifies every value of a record, tolerating a missing input record. */
function toStringRecord(value: Record<string, unknown> | undefined): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    result[key] = String(entryValue);
  }
  return result;
}

/**
 * Executor for `http` nodes.
 *
 * `node.url`, `node.headers`, `node.queryParams`, and `node.body` are all
 * interpolated against the current expression context before the request
 * is issued. Query params (once interpolated) are appended to the URL via
 * `URLSearchParams`. The request is performed with `undici`'s `request`;
 * a plain-object/array body is JSON-serialized (with a `content-type:
 * application/json` header added unless one was already supplied) as long
 * as the method is not `GET`/`DELETE`. The response body is read according
 * to `node.responseType`:
 * - `"json"`: parsed as JSON, falling back to the raw text if parsing fails.
 * - `"html"` / `"xml"` / `"text"`: read as text.
 * - `"file"`: read as an `ArrayBuffer`.
 *
 * `node.networkMode === "proxy"` reserves one proxy from `ctx.proxyPool` for exactly this call —
 * released in a `finally` regardless of outcome, with a failure reported back to the pool (see
 * `ProxyPoolClient`) only when `request()` itself throws, never for an ordinary non-2xx response.
 */
export const httpExecutor: NodeExecutor<HttpNode> = async (
  node: HttpNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  const expressionContext = ctx.expressionContext();

  const interpolatedUrl = interpolate(node.url, expressionContext);
  const baseUrl = typeof interpolatedUrl === "string" ? interpolatedUrl : String(interpolatedUrl);

  const interpolatedHeaders = toStringRecord(
    node.headers !== undefined
      ? (interpolate(node.headers, expressionContext) as Record<string, unknown>)
      : undefined,
  );

  const interpolatedQueryParams = toStringRecord(
    node.queryParams !== undefined
      ? (interpolate(node.queryParams, expressionContext) as Record<string, unknown>)
      : undefined,
  );

  const interpolatedBody =
    node.body !== undefined ? interpolate(node.body, expressionContext) : undefined;

  let finalUrl = baseUrl;
  if (Object.keys(interpolatedQueryParams).length > 0) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    finalUrl = `${baseUrl}${separator}${new URLSearchParams(interpolatedQueryParams).toString()}`;
  }

  const headers: Record<string, string> = { ...interpolatedHeaders };
  const methodAllowsBody = node.method !== "GET" && node.method !== "DELETE";

  let bodyToSend: string | undefined;
  if (methodAllowsBody && interpolatedBody !== undefined) {
    if (isPlainObject(interpolatedBody) || Array.isArray(interpolatedBody)) {
      bodyToSend = JSON.stringify(interpolatedBody);
      const hasContentType = Object.keys(headers).some(
        (key) => key.toLowerCase() === "content-type",
      );
      if (!hasContentType) {
        headers["content-type"] = "application/json";
      }
    } else {
      bodyToSend = String(interpolatedBody);
    }
  }

  if (node.networkMode === "proxy") {
    if (!ctx.proxyPool) {
      throw new Error(
        `Node "${node.name}" is set to use a proxy, but no proxy pool is available in this environment.`,
      );
    }
    const reserved = await ctx.proxyPool.reserve();
    if (!reserved) {
      throw new Error(`Node "${node.name}": no proxy is currently available in the pool.`);
    }
    // A fresh `ProxyAgent` per reservation, never reused across nodes/reservations, so it's
    // always closed (below) alongside the specific proxy it was built for.
    const dispatcher = new ProxyAgent(`http://${reserved.host}:${reserved.port}`);
    try {
      const response = await request(finalUrl, { method: node.method, headers, body: bodyToSend, dispatcher });
      return {
        output: {
          status: response.statusCode,
          headers: response.headers,
          body: await readResponseBody(response, node.responseType),
        },
      };
    } catch (error) {
      // A normal HTTP response (even a 4xx/5xx) never throws here — only a genuine connection/
      // socket-level failure does, which is exactly the signal that's actually the proxy's fault
      // rather than the target site's own answer.
      await ctx.proxyPool.reportError(reserved.id);
      throw error;
    } finally {
      await ctx.proxyPool.release(reserved.id);
      await dispatcher.close();
    }
  }

  const response = await request(finalUrl, { method: node.method, headers, body: bodyToSend });
  return {
    output: {
      status: response.statusCode,
      headers: response.headers,
      body: await readResponseBody(response, node.responseType),
    },
  };
};
