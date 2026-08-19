import type { Edge, Node } from "@xyflow/react";
import type {
  ActionNode,
  Edge as DomainEdge,
  WorkflowDefinition,
} from "@datarover/workflow-types";

/**
 * Naming convention for this whole app (not just this file): "Edge" always
 * refers to the @xyflow/react visual edge type, imported unaliased. The
 * domain model's edge (from @datarover/workflow-types) is always imported
 * aliased as `DomainEdge`. Never import the domain `Edge` under its own
 * name anywhere in this codebase — it collides with, and is semantically
 * distinct from, the React Flow `Edge`. Follow this convention in any file
 * that touches both the workflow domain model and React Flow.
 *
 * More broadly: React Flow (nodes/edges/positions) is only ever a visual
 * representation of a `WorkflowDefinition`. It is never the source of
 * truth, and layout (node position) is never persisted — see `autoLayout`.
 */

/** Data payload attached to every React Flow node: the domain node itself. */
export interface FlowNodeData extends Record<string, unknown> {
  node: ActionNode;
}

export type FlowNode = Node<FlowNodeData, ActionNode["type"]>;

export type FlowEdge = Edge;

/**
 * Returns the first available id of the form `${type}${n}` (n starting at
 * 1) that isn't already present in `existingIds`. Because the suffix is a
 * plain integer, the result is guaranteed to contain only letters, digits,
 * and (from `type`) underscores — never a hyphen or other punctuation. This
 * matters because node ids are referenced inside `{{ }}` expressions and a
 * condition node's `expression` field, where they must be valid identifiers.
 */
export function generateNodeId(type: ActionNode["type"], existingIds: ReadonlySet<string>): string {
  let counter = 1;
  let candidate = `${type}${counter}`;
  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `${type}${counter}`;
  }
  return candidate;
}

/**
 * Computes a deterministic position for every node in `definition`, purely
 * for visual display — `WorkflowDefinition` never carries layout data, so
 * this is recomputed on every load rather than persisted.
 *
 * Nodes reachable from `startNodeId` are placed by BFS depth: `x = depth *
 * 260`, `y = indexAtThatDepth * 140`. Nodes not reachable from the start
 * node (orphans) are placed afterwards, at `x = 0`, stacked below the
 * deepest/lowest position reached by the BFS.
 */
export function autoLayout(definition: WorkflowDefinition): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const nodeIds = new Set(definition.nodes.map((node) => node.id));

  const outgoing = new Map<string, string[]>();
  for (const edge of definition.edges) {
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
  }

  const visited = new Set<string>();
  const depthCounts = new Map<number, number>();
  // Starts one row above zero so that, if the BFS never visits anything
  // (e.g. an unknown startNodeId), the first orphan still lands at y = 0.
  let maxY = -140;

  if (nodeIds.has(definition.startNodeId)) {
    const queue: Array<{ id: string; depth: number }> = [{ id: definition.startNodeId, depth: 0 }];
    visited.add(definition.startNodeId);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      const { id, depth } = current;
      const indexAtDepth = depthCounts.get(depth) ?? 0;
      depthCounts.set(depth, indexAtDepth + 1);

      const y = indexAtDepth * 140;
      positions.set(id, { x: depth * 260, y });
      maxY = Math.max(maxY, y);

      for (const neighborId of outgoing.get(id) ?? []) {
        if (visited.has(neighborId) || !nodeIds.has(neighborId)) {
          continue;
        }
        visited.add(neighborId);
        queue.push({ id: neighborId, depth: depth + 1 });
      }
    }
  }

  let orphanY = maxY + 140;
  for (const node of definition.nodes) {
    if (positions.has(node.id)) {
      continue;
    }
    positions.set(node.id, { x: 0, y: orphanY });
    orphanY += 140;
  }

  return positions;
}

/**
 * Converts a `WorkflowDefinition` into React Flow's `nodes`/`edges` shape,
 * computing a fresh layout via `autoLayout`. Purely a view-model
 * transformation — never mutates or reads back into the definition.
 */
export function definitionToFlow(definition: WorkflowDefinition): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const positions = autoLayout(definition);

  const nodes: FlowNode[] = definition.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { node },
  }));

  const edges: FlowEdge[] = definition.edges.map((edge) => ({
    id: edge.id ?? `${edge.from}-${edge.to}-${edge.branch ?? "default"}`,
    source: edge.from,
    target: edge.to,
    ...(edge.branch !== undefined ? { sourceHandle: edge.branch, label: edge.branch } : {}),
  }));

  return { nodes, edges };
}

/**
 * Reconstructs a `WorkflowDefinition` from the editor's current React Flow
 * state. Node/edge position is purely visual and is never read here — it
 * is not, and never has been, part of the domain model.
 */
export function flowToDefinition(params: {
  id: string;
  name: string;
  startNodeId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}): WorkflowDefinition {
  const { id, name, startNodeId, nodes, edges } = params;

  return {
    id,
    name,
    startNodeId,
    nodes: nodes.map((flowNode) => flowNode.data.node),
    edges: edges.map((flowEdge) => {
      const domainEdge: DomainEdge = {
        from: flowEdge.source,
        to: flowEdge.target,
      };
      if (flowEdge.sourceHandle === "true" || flowEdge.sourceHandle === "false") {
        domainEdge.branch = flowEdge.sourceHandle;
      }
      return domainEdge;
    }),
  };
}

/**
 * Builds a minimal but schema-valid `ActionNode` of the given `type`,
 * meant as a starting point the user fills in via the inspector form.
 */
export function createDefaultNode(type: ActionNode["type"], id: string): ActionNode {
  switch (type) {
    case "http":
      return { id, name: "New HTTP Request", type: "http", method: "GET", url: "", responseType: "json" };
    case "extract":
      return {
        id,
        name: "New Extraction",
        type: "extract",
        source: "",
        sourceType: "json",
        rules: [{ name: "value", strategy: "jsonpath", selectors: ["$"], output: "value" }],
      };
    case "condition":
      return { id, name: "New Condition", type: "condition", expression: "" };
    case "setVariable":
      return { id, name: "New Variables", type: "setVariable", variables: {} };
    case "stop":
      return { id, name: "Stop", type: "stop" };
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unsupported action node type: ${String(exhaustiveCheck)}`);
    }
  }
}
