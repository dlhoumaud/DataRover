import { z } from "zod";
import { ActionNodeSchema } from "./action";

/**
 * A directed connection between two nodes in a workflow graph. `branch` is
 * used to select which outgoing edge of a `condition` node to follow.
 */
export const EdgeSchema = z.object({
  id: z.string().optional(),
  from: z.string(),
  to: z.string(),
  branch: z.enum(["true", "false"]).optional(),
});
export type Edge = z.infer<typeof EdgeSchema>;

export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  startNodeId: z.string(),
  nodes: z.array(ActionNodeSchema).min(1),
  edges: z.array(EdgeSchema).default([]),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
