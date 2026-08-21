import type { ActionNode } from "@datarover/workflow-types";

/**
 * Single source of truth for each node type's color dot and label — shared by the canvas node
 * (components/nodes/WorkflowNode.tsx) and the node-creation palette (components/NodePalette.tsx)
 * so a given type reads the same color in both places, letting the palette double as a legend.
 */
export const NODE_COLORS: Record<ActionNode["type"], string> = {
  http: "bg-blue-500",
  browserAction: "bg-blue-300",
  extract: "bg-cyan-500",
  condition: "bg-orange-500",
  loop: "bg-orange-300",
  setVariable: "bg-green-500",
  dataTransform: "bg-green-300",
  textCrypto: "bg-green-200",
  stop: "bg-black",
};

export const NODE_LABELS: Record<ActionNode["type"], string> = {
  http: "http",
  browserAction: "Navigateur",
  extract: "extract",
  condition: "condition",
  loop: "Boucle",
  setVariable: "setVariable",
  dataTransform: "Traitement",
  textCrypto: "textCrypto",
  stop: "stop",
};
