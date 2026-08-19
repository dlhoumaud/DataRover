import type { ActionNode } from "@datarover/workflow-types";

/**
 * Single source of truth for each node type's color dot and label — shared by the canvas node
 * (components/nodes/WorkflowNode.tsx) and the node-creation palette (components/NodePalette.tsx)
 * so a given type reads the same color in both places, letting the palette double as a legend.
 */
export const NODE_COLORS: Record<ActionNode["type"], string> = {
  http: "bg-blue-500",
  extract: "bg-purple-500",
  condition: "bg-yellow-500",
  setVariable: "bg-green-500",
  stop: "bg-red-500",
  dataTransform: "bg-teal-500",
  textCrypto: "bg-orange-500",
};

export const NODE_LABELS: Record<ActionNode["type"], string> = {
  http: "http",
  extract: "extract",
  condition: "condition",
  setVariable: "setVariable",
  stop: "stop",
  dataTransform: "Traitement",
  textCrypto: "textCrypto",
};
