import { BadRequestException, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { chromium, type Browser, type Page } from "playwright-core";
import { resolveChromeBinary } from "./chromeBinary";

/** Generous but bounded — a real page (SPA hydration, initial data fetch) needs real time. */
const RENDER_TIMEOUT_MS = 20_000;

/**
 * Selectors for the "accept" button of the most common cookie-consent platforms (Didomi,
 * OneTrust, Quantcast/IAB TCF, Cookiebot). Tried in order before the generic text-based fallback
 * below. Real-world finding: a consent banner from one of these renders as a full-screen overlay
 * that visually and functionally blocks the entire page underneath — verified by screenshotting an
 * actual rendered preview, where the real product content existed in the DOM but was completely
 * covered and unclickable behind the banner.
 */
/** Per-selector budget while racing candidates in dismissConsentBanner — a CMP script can take a
 *  couple of seconds to finish initializing before its dialog actually renders. */
const KNOWN_SELECTOR_TIMEOUT_MS = 4_000;

const CONSENT_DISMISS_SELECTORS = [
  "#didomi-notice-agree-button",
  "#onetrust-accept-btn-handler",
  ".qc-cmp2-summary-buttons button[mode='primary']",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "button[aria-label='Accept all']",
  "button[aria-label='Tout accepter']",
];

export interface RenderedPage {
  status: number;
  html: string;
}

/**
 * Renders a URL in a real, disposable headless browser and returns the resulting DOM as a static
 * HTML string — backs the "Rendu JavaScript" option of the preview tool (Specs.md §6), for target
 * pages whose real content only exists after client-side JS runs (a React/Vue SPA shell with no
 * meaningful server-rendered markup — verified against a real reported page: no `<h1>` at all in
 * the plain fetch, even with a crawler-friendly User-Agent).
 *
 * This is the ONLY place in the app that ever executes a target site's own JavaScript, and it
 * happens in a fully separate, disposable OS process (the browser this service drives) — never
 * inside this Node process, and never inside the frontend. The HTML this returns is inert text by
 * the time it reaches apps/web: it goes through the exact same sanitization pipeline
 * (buildSandboxedDocument) as a plain, unrendered fetch, scripts stripped and never re-executed.
 *
 * Scoped strictly to the interactive editor tool — never to workflow *execution*. The engine's
 * `http` executor stays HTTP-only (undici); this does not change ARCHITECTURE.md's documented
 * scope boundary that browser crawling isn't implemented for the engine itself.
 *
 * Drives whatever real Chrome/Chromium is already installed on the machine (see chromeBinary.ts)
 * rather than have `playwright-core` download and manage its own browser build — both to skip
 * that network/disk cost and because the bundled build needs system libraries this environment may
 * not have `sudo` to install.
 */
@Injectable()
export class BrowserRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserRendererService.name);
  private browserPromise: Promise<Browser> | null = null;

  async render(url: string, headers: Record<string, string> | undefined): Promise<RenderedPage> {
    const browser = await this.getBrowser();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      if (headers && Object.keys(headers).length > 0) {
        await page.setExtraHTTPHeaders(headers);
      }

      // "domcontentloaded" first (fast, rarely times out) — a genuine failure here (DNS,
      // connection refused, an actual navigation timeout) is a real problem worth surfacing.
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS });

      await this.dismissConsentBanner(page);

      // Best-effort from here: wait for the page to settle (finish its data fetch/hydration)
      // without letting a page with persistent background polling/analytics block the whole
      // preview — the DOM at timeout is still a perfectly usable, likely-already-settled snapshot.
      await page.waitForLoadState("networkidle", { timeout: RENDER_TIMEOUT_MS }).catch(() => {
        this.logger.warn(`Render of "${url}" timed out waiting for network idle — using the DOM as-is.`);
      });

      const html = await page.content();
      return { status: response?.status() ?? 200, html };
    } finally {
      await context.close();
    }
  }

  /**
   * Best-effort: click whatever looks like a cookie-consent "accept" button, so the captured DOM
   * reflects the actual page rather than a full-screen consent overlay. This runs entirely inside
   * the browser we already control (Playwright driving real clicks, plus one small
   * `page.evaluate` we author ourselves to search for a text match) — never anything sourced from
   * the target page. Never throws: a banner we fail to dismiss just means the preview shows the
   * banner, not that the whole render fails.
   */
  private async dismissConsentBanner(page: Page): Promise<void> {
    // Tried concurrently, not one-after-another: a CMP (Cookiebot, in the real reported case)
    // can take a couple of seconds to finish initializing and render its dialog — trying each of
    // several selectors sequentially, each waiting out its own timeout before the next one even
    // starts, can burn that whole budget on the selectors that never match before ever reaching
    // the one that would. Racing them means whichever selector's element actually appears (real
    // or none) is what determines the outcome, in roughly one timeout's worth of wall-clock time
    // rather than N of them.
    const attempts = await Promise.all(
      CONSENT_DISMISS_SELECTORS.map((selector) =>
        page
          .locator(selector)
          .first()
          .click({ timeout: KNOWN_SELECTOR_TIMEOUT_MS })
          .then(
            () => true,
            () => false,
          ),
      ),
    );
    if (attempts.some(Boolean)) {
      return;
    }

    try {
      // A string (not a typed arrow function): this project's tsconfig has no DOM lib (a Node
      // backend has no business referencing `document` project-wide), and this snippet only ever
      // runs inside the browser's page context anyway — same "opaque browser-context script"
      // pattern as apps/web/src/lib/htmlSandbox.ts's PICKER_SCRIPT.
      await page.evaluate(`
        (function () {
          var acceptPattern = /^(j.?accepte|tout accepter|accepter( tout| et fermer)?|accepter les cookies|accept all|accept( & close)?|i agree|agree|ok|got it|compris|autoriser tout)$/i;
          var candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
          var match = candidates.find(function (el) {
            return acceptPattern.test((el.textContent || "").trim());
          });
          if (match) {
            match.click();
          }
        })();
      `);
    } catch {
      // Best-effort only.
    }
  }

  /**
   * Lazily launches one shared browser process, reused across renders (each render still gets its
   * own isolated `BrowserContext` — separate cookies/storage — via `render()` above); relaunches
   * if the previous instance died or was never launched.
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browserPromise) {
      const existing = await this.browserPromise.catch(() => null);
      if (existing?.isConnected()) {
        return existing;
      }
      this.browserPromise = null;
    }

    const executablePath = resolveChromeBinary();
    if (!executablePath) {
      throw new BadRequestException(
        "No system Chrome/Chromium found to render this page. Install Google Chrome or " +
          "Chromium, or set CHROME_EXECUTABLE_PATH to its full path.",
      );
    }

    const launchPromise = chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
    this.browserPromise = launchPromise;
    try {
      return await launchPromise;
    } catch (error) {
      this.browserPromise = null;
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) {
      return;
    }
    const browser = await this.browserPromise.catch(() => null);
    await browser?.close().catch(() => undefined);
  }
}
