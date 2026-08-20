import type { ActionNode } from "@datarover/workflow-types";

/**
 * Single source of truth for each node type's color dot and label — shared by the canvas node
 * (components/nodes/WorkflowNode.tsx) and the node-creation palette (components/NodePalette.tsx)
 * so a given type reads the same color in both places, letting the palette double as a legend.
 */
export const NODE_COLORS: Record<ActionNode["type"], string> = {
  http: "bg-blue-500",
  browserAction: "bg-cyan-500",
  condition: "bg-yellow-500",
  loop: "bg-orange-500",
  extract: "bg-purple-500",
  setVariable: "bg-green-500",
  dataTransform: "bg-teal-500",
  textCrypto: "bg-yellow-500",
  stop: "bg-red-500",
};

export const NODE_LABELS: Record<ActionNode["type"], string> = {
  http: "http",
  browserAction: "Navigateur",
  condition: "condition",
  loop: "Boucle",
  extract: "extract",
  setVariable: "setVariable",
  dataTransform: "Traitement",
  textCrypto: "textCrypto",
  stop: "stop",
};
