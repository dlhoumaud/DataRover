/**
 * Thin fetch wrapper shared by every hook in src/api/*. Centralizes the base
 * URL, default headers, JSON (de)serialization, and error normalization so
 * individual hooks stay one-liners.
 */

// Exported (not just module-local) so lib/htmlSandbox.ts can build asset-proxy URLs
// (`${API_BASE_URL}/tools/preview-asset?...`) without a second, divergent source of truth.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ValidationIssue {
  message?: string;
  path?: Array<string | number>;
}

/**
 * Shape of an error body coming back from the API. Covers both the plain
 * Nest HTTP exception filter shape (`{ statusCode, message, error }`, where
 * `message` may be a single string or an array of strings) and the
 * ZodValidationPipe shape used for request validation failures
 * (`{ message: "Validation failed", issues: [...] }`).
 */
interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
  error?: string;
  issues?: ValidationIssue[];
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === "object" && value !== null;
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (!isApiErrorBody(body)) {
    return fallback;
  }

  if (Array.isArray(body.issues) && body.issues.length > 0) {
    const joined = body.issues
      .map((issue) => issue.message ?? issue.path?.join("."))
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(", ");
    if (joined.length > 0) {
      return joined;
    }
  }

  if (Array.isArray(body.message) && body.message.length > 0) {
    return body.message.join(", ");
  }

  if (typeof body.message === "string" && body.message.length > 0) {
    return body.message;
  }

  return fallback;
}

/**
 * Issues a JSON request against the API and returns the parsed body.
 *
 * - A `204 No Content` response resolves to `undefined` without attempting
 *   to parse a (necessarily empty) body.
 * - A non-2xx response is turned into a rejected promise carrying an
 *   `ApiError`, with a human-readable message extracted from the response
 *   body when possible, falling back to `res.statusText`.
 */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      // Fastify's default JSON body parser rejects a request that declares
      // `content-type: application/json` but sends no body at all (e.g. the
      // bodyless `POST /workflows/:id/executions`) — only set it when there
      // is actually something to parse.
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body: unknown = await res.json();
      message = extractErrorMessage(body, res.statusText);
    } catch {
      // Body was empty or not valid JSON — keep the statusText fallback.
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
