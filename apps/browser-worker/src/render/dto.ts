import { z } from "zod";

export const RenderSchema = z.object({
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
});
export type RenderDto = z.infer<typeof RenderSchema>;
