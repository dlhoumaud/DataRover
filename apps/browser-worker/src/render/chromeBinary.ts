import { existsSync } from "node:fs";

/**
 * Candidate paths for a system-installed Chrome/Chromium binary, checked in order. Mirrors
 * apps/web/e2e/support/firefox.ts's approach for the browser e2e suite: rather than have
 * `playwright-core` download and manage its own browser build, we drive whatever real browser is
 * already installed — a system package installed via the Dockerfile in the container image this
 * service actually runs in production, or a locally-installed browser during plain `pnpm dev`.
 *
 * `CHROME_EXECUTABLE_PATH` lets any environment (Docker image, CI, a different distro, macOS)
 * override this entirely.
 */
const CANDIDATE_PATHS = [
  process.env.CHROME_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google/chrome/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // macOS
].filter((candidate): candidate is string => Boolean(candidate));

/**
 * Resolves the path to a real Chrome/Chromium executable that `playwright-core` can launch
 * directly. Returns `undefined` (rather than throwing) when nothing is found — the caller decides
 * whether that's fatal.
 */
export function resolveChromeBinary(): string | undefined {
  return CANDIDATE_PATHS.find((candidate) => existsSync(candidate));
}
