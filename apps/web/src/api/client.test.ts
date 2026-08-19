import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "./client";

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function emptyBodyErrorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
  } as unknown as Response;
}

function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    statusText: "No Content",
    json: () => Promise.reject(new Error("json() should not be called for a 204 response")),
  } as unknown as Response;
}

describe("apiRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the parsed JSON body on success", async () => {
    const payload = { id: "p1", name: "Demo" };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, payload));

    const result = await apiRequest<typeof payload>("/projects/p1");

    expect(result).toEqual(payload);
  });

  it("sets content-type: application/json only when a body is actually sent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(201, { id: "p1" }));
    await apiRequest("/projects", { method: "POST", body: JSON.stringify({ name: "Demo" }) });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3001/projects",
      expect.objectContaining({
        headers: expect.objectContaining({ "content-type": "application/json" }),
      }),
    );

    // Fastify's default JSON body parser rejects a request that declares
    // `content-type: application/json` but sends no body at all (e.g. the bodyless
    // `POST /workflows/:id/executions`) — the header must be absent in that case.
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(202, { id: "e1" }));
    await apiRequest("/workflows/w1/executions", { method: "POST" });
    const [, secondCallInit] = vi.mocked(fetch).mock.calls[1] ?? [];
    expect(secondCallInit).toBeDefined();
    expect((secondCallInit as RequestInit).headers).not.toHaveProperty("content-type");
  });

  it("returns undefined for a 204 No Content response without parsing a body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(noContentResponse());

    const result = await apiRequest<undefined>("/projects/p1", { method: "DELETE" });

    expect(result).toBeUndefined();
  });

  it("throws an ApiError built from a { message } error body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { statusCode: 404, message: "Project not found", error: "Not Found" }, "Not Found"),
    );

    await expect(apiRequest("/projects/missing")).rejects.toMatchObject({
      status: 404,
      message: "Project not found",
    });
    await expect(apiRequest("/projects/missing")).rejects.toBeInstanceOf(ApiError);
  });

  it("throws an ApiError with a joined message built from a ZodValidationPipe { issues } body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        400,
        {
          message: "Validation failed",
          issues: [
            { message: "Expected string, received number", path: ["name"] },
            { path: ["definition", "startNodeId"] },
          ],
        },
        "Bad Request",
      ),
    );

    await expect(apiRequest("/projects")).rejects.toMatchObject({
      status: 400,
      message: "Expected string, received number, definition.startNodeId",
    });
  });

  it("falls back to statusText when the error body isn't parsable JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(emptyBodyErrorResponse(500, "Internal Server Error"));

    await expect(apiRequest("/projects")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });
});
