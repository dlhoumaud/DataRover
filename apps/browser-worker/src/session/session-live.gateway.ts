import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import fastifyWebsocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { BrowserActionStepSchema } from "@datarover/workflow-types";
import { resolveChromeBinary } from "../render/chromeBinary";
import { assertPublicTarget } from "./ssrfGuard";
import { buildRecorderInitScript } from "./recorderScript";
import { ClientMessageSchema, type ClientMessage, type ServerMessage } from "./liveMessages";

/** Same generous-but-bounded rationale as render.service.ts's RENDER_TIMEOUT_MS / session.service.ts's STEP_TIMEOUT_MS. */
const NAVIGATION_TIMEOUT_MS = 20_000;

/**
 * Bounds for the `wait` step auto-inserted before each recorded action (see
 * `LiveSession.handleRecordedStep`) — a real user never acts at a perfectly even cadence, and a
 * replayed sequence with zero pauses between every click/type reads as obviously scripted. Below
 * `MIN`, the gap is just normal recorder/network jitter, not a deliberate pause worth replaying.
 * Above `MAX`, it's the user having stepped away rather than "waiting" in-character — capped
 * rather than propagated verbatim so one long break doesn't turn a replay into an hours-long run.
 */
const AUTO_WAIT_MIN_MS = 400;
const AUTO_WAIT_MAX_MS = 15_000;

/**
 * Registers `GET /session/live` directly on the underlying Fastify instance NestJS's
 * `FastifyAdapter` already exposes — there is no first-class Nest decorator for a *raw* WebSocket
 * route the way `@fastify/websocket` models it (`@nestjs/websockets` targets socket.io/its own
 * gateway abstraction, not this), so this is the same "grab the instance via `HttpAdapterHost` and
 * call a plain Fastify API on it" pattern already used for the ordinary REST controllers in this
 * app, just for one extra plugin registration + route instead of a `@Controller()` class.
 *
 * One `LiveSession` per connection — see its own doc comment for why it, not this gateway, owns
 * the actual browser lifecycle.
 */
@Injectable()
export class SessionLiveGateway implements OnModuleInit {
  private readonly logger = new Logger(SessionLiveGateway.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.httpAdapterHost.httpAdapter.getInstance<FastifyInstance>();
    await fastify.register(fastifyWebsocket);
    fastify.get("/session/live", { websocket: true }, (socket: WebSocket) => {
      new LiveSession(socket, this.logger).start();
    });
  }
}

/**
 * Owns exactly one dedicated browser/context/page for the lifetime of one `/session/live`
 * connection — never `render.service.ts`'s shared singleton, same isolation rationale as
 * `session.service.ts`'s `/session/run` (a live, interactive session is if anything longer-lived
 * and more exposed to a stuck/crashed page than a batch run is). Everything closes together the
 * moment the socket does, from either end, or errors.
 *
 * Messages are processed strictly one at a time (`enqueue`), even though nothing here technically
 * requires awaiting one Playwright call before issuing the next — a burst of `mouseMove` messages
 * from a fast, real pointer-drag is exactly the case where relying on incidental ordering would be
 * asking for a subtle, hard-to-reproduce bug.
 */
class LiveSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private isRecording = false;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  /** Timestamp of the last recorded action, so `handleRecordedStep` can insert a `wait` step
   *  reflecting how long the user actually paused between two actions — `null` right after
   *  `startRecording` so the *first* action of a session never gets a spurious wait measured from
   *  whenever the session happened to start (which has nothing to do with the user's own pacing). */
  private lastRecordedActionAt: number | null = null;

  constructor(
    private readonly socket: WebSocket,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.socket.on("message", (raw: Buffer | string) => {
      this.enqueue(raw.toString());
    });
    this.socket.on("close", () => {
      void this.cleanup();
    });
    this.socket.on("error", (error: Error) => {
      this.logger.warn(`session/live socket error: ${error.message}`);
      void this.cleanup();
    });
  }

  private enqueue(raw: string): void {
    this.queue = this.queue.then(() => this.handleMessage(raw)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Unexpected error handling a session/live message: ${message}`);
    });
  }

  private send(message: ServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send({ type: "error", message: "Malformed message: not valid JSON" });
      return;
    }

    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      this.send({ type: "error", message: `Malformed message: ${result.error.message}` });
      return;
    }

    try {
      await this.dispatch(result.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.send({ type: "error", message });
    }
  }

  private async dispatch(message: ClientMessage): Promise<void> {
    if (message.type === "start") {
      await this.handleStart(message.startUrl);
      return;
    }

    const page = this.page;
    if (!page) {
      this.send({ type: "error", message: `Received "${message.type}" before "start"` });
      return;
    }

    switch (message.type) {
      case "mouseMove":
        await page.mouse.move(message.x, message.y);
        return;
      case "mouseDown":
        await page.mouse.move(message.x, message.y);
        await page.mouse.down({ button: message.button });
        return;
      case "mouseUp":
        await page.mouse.move(message.x, message.y);
        await page.mouse.up({ button: message.button });
        return;
      case "wheel":
        await page.mouse.wheel(message.deltaX, message.deltaY);
        return;
      case "keyDown":
        await page.keyboard.down(message.key);
        return;
      case "keyUp":
        await page.keyboard.up(message.key);
        return;
      case "startRecording":
        this.isRecording = true;
        this.lastRecordedActionAt = null;
        await this.setRecordingFlag(true);
        return;
      case "stopRecording":
        this.isRecording = false;
        await this.setRecordingFlag(false);
        return;
      default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unsupported message: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  // A string, not a typed arrow function — this project's tsconfig has no DOM lib (a Node
  // backend has no business referencing `window` project-wide), and this snippet only ever runs
  // inside the browser's page context anyway. Same pattern as render.service.ts's
  // dismissConsentBanner and apps/web's PICKER_SCRIPT.
  private async setRecordingFlag(value: boolean): Promise<void> {
    await this.page?.evaluate(`window.__datarover_recording__ = ${JSON.stringify(value)};`);
  }

  private async handleStart(startUrl: string): Promise<void> {
    if (this.page) {
      this.send({ type: "error", message: "Session already started" });
      return;
    }

    await assertPublicTarget(startUrl);

    const executablePath = resolveChromeBinary();
    if (!executablePath) {
      throw new Error(
        "No system Chrome/Chromium found to run this session. Install Google Chrome or Chromium, or set CHROME_EXECUTABLE_PATH to its full path.",
      );
    }

    this.browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    await this.page.exposeFunction("__datarover_record__", (stepJson: string) => {
      this.handleRecordedStep(stepJson);
    });
    await this.page.addInitScript(buildRecorderInitScript());
    // A navigation the user's own recorded click triggers lands on a brand-new document, whose
    // freshly-injected recorder always starts with recording OFF (see recorderScript.ts's doc
    // comment) — re-arm it here if a recording session was already in progress.
    this.page.on("load", () => {
      if (this.isRecording) {
        void this.setRecordingFlag(true);
      }
    });

    this.cdpSession = await this.context.newCDPSession(this.page);
    this.cdpSession.on("Page.screencastFrame", (event) => {
      this.send({ type: "frame", data: event.data });
      this.cdpSession?.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
    });
    await this.cdpSession.send("Page.startScreencast", { format: "jpeg", quality: 60 });

    try {
      await this.page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to navigate to "${startUrl}": ${message}`);
    }

    this.send({ type: "ready", viewport: this.page.viewportSize() });
  }

  private handleRecordedStep(stepJson: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stepJson);
    } catch {
      this.logger.warn(`Dropped a recorded step: not valid JSON (${stepJson.slice(0, 100)})`);
      return;
    }
    const result = BrowserActionStepSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(`Dropped a recorded step that failed validation: ${result.error.message}`);
      return;
    }

    const now = Date.now();
    if (this.lastRecordedActionAt !== null) {
      const gapMs = now - this.lastRecordedActionAt;
      if (gapMs >= AUTO_WAIT_MIN_MS) {
        this.send({ type: "action", step: { type: "wait", ms: Math.min(gapMs, AUTO_WAIT_MAX_MS) } });
      }
    }
    this.lastRecordedActionAt = now;

    this.send({ type: "action", step: result.data });
  }

  private async cleanup(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.context?.close();
    } catch {
      // Best-effort — the browser process itself is closed right after regardless.
    }
    try {
      await this.browser?.close();
    } catch {
      // Best-effort.
    }
  }
}
