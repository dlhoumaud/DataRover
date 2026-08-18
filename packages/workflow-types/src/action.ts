import { z } from "zod";

/**
 * Retry behaviour applied by the execution engine when a node fails.
 */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).default(1),
  backoffMs: z.number().int().min(0).default(0),
  backoffMultiplier: z.number().min(1).default(1),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/**
 * Fields shared by every node type in a workflow graph.
 * Not exported: consumers should rely on the discriminated `ActionNodeSchema`
 * union (and its inferred `ActionNode` type) rather than this base shape.
 */
const BaseNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  retryPolicy: RetryPolicySchema.optional(),
});

/**
 * Performs an HTTP request.
 */
export const HttpNodeSchema = BaseNodeSchema.extend({
  type: z.literal("http"),
  method: HttpMethod,
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  responseType: z.enum(["html", "json", "xml", "text", "file"]).default("json"),
});
export type HttpNode = z.infer<typeof HttpNodeSchema>;

export const ExtractSourceType = z.enum(["html", "json", "xml"]);
export type ExtractSourceType = z.infer<typeof ExtractSourceType>;

/**
 * Strategy used to locate data within a source document.
 *
 * NOTE: "xpath" is a valid type at the schema/typing level in this
 * iteration, but its execution is NOT implemented yet (planned for V2).
 * It is accepted here purely as a typing constraint.
 */
export const ExtractStrategyType = z.enum(["css", "xpath", "jsonpath", "regex"]);
export type ExtractStrategyType = z.infer<typeof ExtractStrategyType>;

export const ExtractOutputType = z.enum(["text", "attribute", "list", "table", "value"]);
export type ExtractOutputType = z.infer<typeof ExtractOutputType>;

export const ExtractionRuleSchema = z.object({
  name: z.string(),
  strategy: ExtractStrategyType,
  selectors: z.array(z.string()).min(1),
  attribute: z.string().optional(),
  output: ExtractOutputType.default("text"),
});
export type ExtractionRule = z.infer<typeof ExtractionRuleSchema>;

/**
 * Extracts structured data from a previously fetched source using one or
 * more extraction rules.
 */
export const ExtractNodeSchema = BaseNodeSchema.extend({
  type: z.literal("extract"),
  source: z.string(),
  sourceType: ExtractSourceType,
  rules: z.array(ExtractionRuleSchema).min(1),
});
export type ExtractNode = z.infer<typeof ExtractNodeSchema>;

/**
 * Branches the workflow graph based on a boolean expression evaluated at
 * runtime. Downstream edges select their branch via `Edge.branch`.
 */
export const ConditionNodeSchema = BaseNodeSchema.extend({
  type: z.literal("condition"),
  expression: z.string(),
});
export type ConditionNode = z.infer<typeof ConditionNodeSchema>;

/**
 * Assigns one or more variables in the current execution context.
 */
export const SetVariableNodeSchema = BaseNodeSchema.extend({
  type: z.literal("setVariable"),
  variables: z.record(z.string(), z.string()),
});
export type SetVariableNode = z.infer<typeof SetVariableNodeSchema>;

/**
 * Terminates the workflow execution, optionally recording a reason.
 */
export const StopNodeSchema = BaseNodeSchema.extend({
  type: z.literal("stop"),
  reason: z.string().optional(),
});
export type StopNode = z.infer<typeof StopNodeSchema>;

export const ActionNodeSchema = z.discriminatedUnion("type", [
  HttpNodeSchema,
  ExtractNodeSchema,
  ConditionNodeSchema,
  SetVariableNodeSchema,
  StopNodeSchema,
]);
export type ActionNode = z.infer<typeof ActionNodeSchema>;

export type ActionNodeType = ActionNode["type"];
