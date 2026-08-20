import { BadRequestException, Injectable } from "@nestjs/common";
import { request } from "undici";

/** Generous but bounded — matches apps/browser-worker's own RENDER_TIMEOUT_MS (20s) for the
 * actual render, plus headroom for the HTTP round trip itself. */
const RENDER_REQUEST_TIMEOUT_MS = 25_000;

export interface RenderedPage {
  status: number;
  html: string;
}

/**
 * HTTP client for the `browser-worker` service (Specs.md §19-20: browser rendering must be a
 * separate service from apps/api/apps/worker, isolating a slow/stuck/crashed Playwright render so
 * it can never affect either). Used only by `ToolsService.previewHtml`'s `render: true` branch —
 * apps/api itself never launches a browser or depends on `playwright-core` (see this app's
 * package.json; that dependency moved to apps/browser-worker entirely).
 *
 * `BROWSER_WORKER_URL` defaults to `http://localhost:3002` (plain local dev, both processes on
 * the same host); in Docker it's the service's own name on the compose network
 * (`http://browser-worker:3002`, see docker-compose.yml).
 */
@Injectable()
export class BrowserWorkerClient {
  private readonly baseUrl = process.env.BROWSER_WORKER_URL ?? "http://localhost:3002";

  async render(url: string, headers: Record<string, string> | undefined): Promise<RenderedPage> {
    let response;
    try {
      response = await request(`${this.baseUrl}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, headers }),
        headersTimeout: RENDER_REQUEST_TIMEOUT_MS,
        bodyTimeout: RENDER_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Could not reach the browser-worker service: ${message}`);
    }

    const text = await response.body.text();

    if (response.statusCode >= 400) {
      // browser-worker already distinguishes a bad/unreachable target (400) from a genuine
      // internal failure (500) — see RenderService.render — but either way the preview tool has
      // nothing useful to do except report it, so both surface the same way to its own caller.
      let message = text;
      try {
        const parsed = JSON.parse(text) as { message?: string };
        message = parsed.message ?? text;
      } catch {
        // Not JSON — use the raw body as-is.
      }
      throw new BadRequestException(`Failed to render "${url}": ${message}`);
    }

    const body = JSON.parse(text) as RenderedPage;
    return body;
  }
}
