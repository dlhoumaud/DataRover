import { BrowserActionStepSchema } from "@datarover/workflow-types";
import { z } from "zod";

/**
 * Body of `POST /session/run`. `steps` reuses `BrowserActionStepSchema` from
 * `@datarover/workflow-types` directly — the wire format between
 * `browserActionExecutor.ts` and this route IS that node's own step schema, not a separate,
 * independently-maintained copy of it.
 */
export const SessionRunSchema = z.object({
  startUrl: z.string().min(1),
  steps: z.array(BrowserActionStepSchema).min(1),
  /** Chosen by `browserActionExecutor.ts` (already reserved from the global pool before this
   *  request is even sent) — this route never picks a proxy itself, only uses the one it's given. */
  proxy: z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535) }).optional(),
});
export type SessionRunDto = z.infer<typeof SessionRunSchema>;
