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
});
export type SessionRunDto = z.infer<typeof SessionRunSchema>;
