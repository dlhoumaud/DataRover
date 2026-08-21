import { z } from "zod";

/**
 * Messages a client sends over `GET /session/live` (see `session-live.gateway.ts`). One
 * connection, one session: `"start"` must be the first message (it picks the target and launches
 * the dedicated browser), everything else acts on the page that navigation opened.
 */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), startUrl: z.string().min(1) }),
  z.object({ type: z.literal("mouseMove"), x: z.number(), y: z.number() }),
  z.object({
    type: z.literal("mouseDown"),
    x: z.number(),
    y: z.number(),
    button: z.enum(["left", "right", "middle"]).default("left"),
  }),
  z.object({
    type: z.literal("mouseUp"),
    x: z.number(),
    y: z.number(),
    button: z.enum(["left", "right", "middle"]).default("left"),
  }),
  z.object({ type: z.literal("wheel"), deltaX: z.number().default(0), deltaY: z.number() }),
  z.object({ type: z.literal("keyDown"), key: z.string().min(1) }),
  z.object({ type: z.literal("keyUp"), key: z.string().min(1) }),
  z.object({ type: z.literal("startRecording") }),
  z.object({ type: z.literal("stopRecording") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Messages this route sends back. `"action"` carries a `BrowserActionStep`-shaped object, but
 *  deliberately typed as `unknown` here rather than importing `BrowserActionStep` — what actually
 *  comes out of the in-page recorder is validated (or rejected) by the *client*, which already
 *  has to parse an arbitrary JSON payload from the wire either way; this module only describes
 *  the envelope, not the recorded step's own shape. */
export type ServerMessage =
  | { type: "ready"; viewport: { width: number; height: number } | null }
  | { type: "frame"; data: string }
  | { type: "action"; step: unknown }
  | { type: "error"; message: string };
