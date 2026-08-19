export const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:5173";
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";

/**
 * Fails fast with an actionable message when a prerequisite process isn't reachable, instead of
 * letting the browser automation time out 30s later with a generic "element not found".
 */
export async function assertReachable(url: string, label: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`responded with HTTP ${String(res.status)}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} is not reachable at ${url} (${reason}). The e2e suite drives the real stack — ` +
        `run "pnpm infra:up" and "pnpm dev" (or the production equivalents) first.`,
    );
  }
}
