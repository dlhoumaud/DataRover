import { z } from "zod";
import { WorkflowDefinitionSchema } from "@datarover/workflow-types";

/**
 * `definition.id` is deliberately NOT accepted from the caller: the service
 * assigns it itself (equal to the Prisma `Workflow.id`) so the JSON blob
 * persisted in `WorkflowVersion.definition` is always self-describing.
 */
export const CreateWorkflowSchema = z.object({
  name: z.string().min(1),
  definition: WorkflowDefinitionSchema.omit({ id: true }),
});
export type CreateWorkflowDto = z.infer<typeof CreateWorkflowSchema>;

export const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  definition: WorkflowDefinitionSchema.omit({ id: true }).optional(),
});
export type UpdateWorkflowDto = z.infer<typeof UpdateWorkflowSchema>;
