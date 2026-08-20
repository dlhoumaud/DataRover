import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { BrowserActionStep, DelaySpec } from "@datarover/workflow-types";
import { chromium, type Browser, type Page } from "playwright-core";
import { resolveChromeBinary } from "../render/chromeBinary";
import { assertPublicTarget } from "./ssrfGuard";

/** Per-navigation/selector-wait budget — same generous-but-bounded rationale as
 *  render.service.ts's RENDER_TIMEOUT_MS. A single `session.service.ts` call can involve several
 *  of these back to back (one per step), which is why `browserActionExecutor.ts`'s own HTTP
 *  request timeout to this service is set well above this value. */
const STEP_TIMEOUT_MS = 20_000;

/** Intermediate mouse-move events Playwright synthesizes between the start and end point of a
 *  `mouse.move()` call (default is 1 — a single instantaneous jump). A modest, fixed number here
 *  is what makes `moveMouse`/`moveMouseRandom` look like an actual pointer gliding across the
 *  page rather than teleporting — not exposed as a step field, since the user only asked for
 *  position + timing control, not this. */
const MOUSE_MOVE_STEPS = 15;

/** A safe fallback viewport size, used only if `page.viewportSize()` somehow returns `null` (it
 *  shouldn't: `browser.newContext()` is called with no `viewport: null` override anywhere in this
 *  service, so Playwright always provisions its own default viewport). */
const FALLBACK_VIEWPORT = { width: 1280, height: 720 };

/** Draws a fresh duration every call for `"random"` — see `DelaySpecSchema`'s doc comment on why
 *  that's the whole point (a fixed value would replay identically every time, which is not what
 *  "simulate human timing" means). `undefined` (no delay configured) is 0, not "skip the pause
 *  entirely" as a distinct code path — callers always await this. */
function sampleDelayMs(delay: DelaySpec | undefined): number {
  if (delay === undefined) {
    return 0;
  }
  if (delay.kind === "fixed") {
    return delay.ms;
  }
  return delay.minMs + Math.random() * (delay.maxMs - delay.minMs);
}

export interface SessionRunResult {
  status: number;
  html: string;
}

/**
 * Executes a `browserAction` node's step sequence: navigates to `startUrl`, replays every step
 * in order against a real, disposable headless browser, then returns the final page HTML once
 * settled — the batch-execution counterpart of `render.service.ts`'s `/render`, backing
 * `browserActionExecutor.ts` (real workflow *execution*, not just the editor preview tool).
 *
 * Deliberately launches its OWN dedicated `Browser` process per call rather than reusing
 * `RenderService`'s shared singleton: this route can run long (several steps, possibly slow
 * pages) and is driven by real, potentially-unattended executions — sharing one browser process
 * across that and the interactive preview tool would let one bad session take the other down
 * with it. The cost is a Chromium launch per call (~1-2s); given this service's whole reason for
 * existing is isolating a slow/stuck/crashed browser from the rest of the app, that trade is the
 * right one here.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  async run(startUrl: string, steps: BrowserActionStep[]): Promise<SessionRunResult> {
    await assertPublicTarget(startUrl);

    const browser = await this.launchDedicatedBrowser();
    try {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();

        const response = await this.goto(page, startUrl);

        for (const [index, step] of steps.entries()) {
          await this.runStep(page, step, index);
        }

        await page.waitForLoadState("networkidle", { timeout: STEP_TIMEOUT_MS }).catch(() => {
          this.logger.warn(`Session at "${startUrl}" timed out waiting for network idle — using the DOM as-is.`);
        });

        const html = await page.content();
        return { status: response?.status() ?? 200, html };
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }

  private async goto(page: Page, url: string): ReturnType<Page["goto"]> {
    try {
      return await page.goto(url, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to navigate to "${url}": ${message}`);
    }
  }

  private async runStep(page: Page, step: BrowserActionStep, index: number): Promise<void> {
    try {
      switch (step.type) {
        case "navigate":
          // Every `navigate` step's URL is, like `startUrl`, ultimately runtime-interpolated
          // upstream data — guarded exactly the same way before Playwright ever dials it.
          await assertPublicTarget(step.url);
          await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
          return;
        case "click":
          await page.locator(step.selector).click({ timeout: STEP_TIMEOUT_MS });
          return;
        case "type":
          // Character-by-character (never `.fill()`) — see BrowserActionStepSchema's doc comment
          // for why this distinction is this node's whole reason for existing.
          await this.type(page, step.selector, step.text, step.delay);
          return;
        case "press":
          await page.keyboard.press(step.key);
          return;
        case "select":
          await page.locator(step.selector).selectOption(step.value, { timeout: STEP_TIMEOUT_MS });
          return;
        case "hover":
          await page.locator(step.selector).hover({ timeout: STEP_TIMEOUT_MS });
          return;
        case "dragTo":
          await page
            .locator(step.sourceSelector)
            .dragTo(page.locator(step.targetSelector), { timeout: STEP_TIMEOUT_MS });
          return;
        case "scrollIntoView":
          await page.locator(step.selector).scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT_MS });
          return;
        case "scrollPage":
          await page.mouse.wheel(step.x, step.y);
          return;
        case "moveMouse":
          await page.mouse.move(step.x, step.y, { steps: MOUSE_MOVE_STEPS });
          await page.waitForTimeout(sampleDelayMs(step.delay));
          return;
        case "moveMouseRandom": {
          const viewport = page.viewportSize() ?? FALLBACK_VIEWPORT;
          await page.mouse.move(Math.random() * viewport.width, Math.random() * viewport.height, {
            steps: MOUSE_MOVE_STEPS,
          });
          await page.waitForTimeout(sampleDelayMs(step.delay));
          return;
        }
        case "wait":
          await page.waitForTimeout(step.ms);
          return;
        case "waitForSelector":
          await page.waitForSelector(step.selector, { timeout: STEP_TIMEOUT_MS });
          return;
        default: {
          const exhaustiveCheck: never = step;
          throw new Error(`Unsupported step: ${JSON.stringify(exhaustiveCheck)}`);
        }
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Step ${index + 1} (${step.type}) failed: ${message}`);
    }
  }

  /**
   * Types `text` into `selector`, character by character. A `"fixed"` (or absent) `delay` is
   * handed straight to Playwright's own `pressSequentially`, which already applies one constant
   * inter-key delay natively. A `"random"` delay has no native Playwright equivalent (`delay` is
   * a single number, not a per-keystroke callback), so that case is typed manually: one character
   * at a time via `page.keyboard.type`, with a freshly-sampled pause after each — the only way to
   * get a different, human-like gap between every pair of keystrokes rather than one fixed cadence.
   */
  private async type(page: Page, selector: string, text: string, delay: DelaySpec | undefined): Promise<void> {
    if (delay === undefined || delay.kind === "fixed") {
      await page.locator(selector).pressSequentially(text, { timeout: STEP_TIMEOUT_MS, delay: delay?.ms });
      return;
    }

    // `pressSequentially` also focuses the element first; replicated here since the manual loop
    // below drives `page.keyboard` directly, which assumes something is already focused.
    await page.locator(selector).click({ timeout: STEP_TIMEOUT_MS });
    for (const character of text) {
      await page.keyboard.type(character);
      await page.waitForTimeout(sampleDelayMs(delay));
    }
  }

  /** Launches a fresh, disposable browser — never cached/shared. See this class's doc comment. */
  private async launchDedicatedBrowser(): Promise<Browser> {
    const executablePath = resolveChromeBinary();
    if (!executablePath) {
      throw new BadRequestException(
        "No system Chrome/Chromium found to run this session. Install Google Chrome or " +
          "Chromium, or set CHROME_EXECUTABLE_PATH to its full path.",
      );
    }
    return chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
  }
}
