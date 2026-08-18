import type { z } from "zod";
import { ProjectSchema } from "@datarover/workflow-types";

/**
 * Derived from the shared `ProjectSchema` (@datarover/workflow-types) rather
 * than redefined by hand, so HTTP payload validation always tracks the
 * canonical business model.
 */
export const CreateProjectSchema = ProjectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial();
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
