import { interpolate } from "@datarover/expression-engine";
import type { HttpNode } from "@datarover/workflow-types";
import { request } from "undici";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

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

  const { statusCode, headers: responseHeaders, body } = await request(finalUrl, {
    method: node.method,
    headers,
    body: bodyToSend,
  });

  let parsedBody: unknown;
  switch (node.responseType) {
    case "json": {
      const text = await body.text();
      try {
        parsedBody = text.length > 0 ? JSON.parse(text) : undefined;
      } catch {
        parsedBody = text;
      }
      break;
    }
    case "html":
    case "xml":
    case "text": {
      parsedBody = await body.text();
      break;
    }
    case "file": {
      parsedBody = await body.arrayBuffer();
      break;
    }
  }

  return {
    output: {
      status: statusCode,
      headers: responseHeaders,
      body: parsedBody,
    },
  };
};
