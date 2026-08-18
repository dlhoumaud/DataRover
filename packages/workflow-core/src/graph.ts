import type { ActionNode, Edge, WorkflowDefinition } from "@datarover/workflow-types";

/**
 * Finds the node identified by `nodeId` in `definition`.
 *
 * @throws {Error} If no node with that id exists in `definition.nodes`.
 */
export function getNodeById(definition: WorkflowDefinition, nodeId: string): ActionNode {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new Error(
      `Workflow "${definition.id}": node "${nodeId}" was not found among its nodes`,
    );
  }
  return node;
}

/** Returns every edge in `definition` whose `from` equals `nodeId`, in declaration order. */
export function getOutgoingEdges(definition: WorkflowDefinition, nodeId: string): Edge[] {
  return definition.edges.filter((edge) => edge.from === nodeId);
}

/**
 * Determines the id of the node that should run after `currentNodeId`.
 *
 * - If the current node is a `condition` node, the outgoing edge whose
 *   `branch` matches `branch` exactly (including the case where both are
 *   `undefined`) is followed.
 * - Otherwise, the first outgoing edge with no `branch` set is followed;
 *   if none is unbranched, the first outgoing edge (in declaration order)
 *   is followed instead.
 * - Returns `undefined` when there is no matching outgoing edge, which
 *   signals the natural end of the workflow along this path.
 */
export function getNextNodeId(
  definition: WorkflowDefinition,
  currentNodeId: string,
  branch?: "true" | "false",
): string | undefined {
  const currentNode = getNodeById(definition, currentNodeId);
  const outgoing = getOutgoingEdges(definition, currentNodeId);

  if (currentNode.type === "condition") {
    const matching = outgoing.find((edge) => edge.branch === branch);
    return matching?.to;
  }

  const unbranched = outgoing.filter((edge) => edge.branch === undefined);
  if (unbranched.length > 0) {
    return unbranched[0]?.to;
  }
  return outgoing[0]?.to;
}

/**
 * Validates the structural integrity of a workflow graph.
 *
 * @throws {Error} If `startNodeId` does not reference an existing node, or
 * if any edge's `from`/`to` references a node id that is not present in
 * `definition.nodes`.
 */
export function validateDefinition(definition: WorkflowDefinition): void {
  const nodeIds = new Set(definition.nodes.map((node) => node.id));

  if (!nodeIds.has(definition.startNodeId)) {
    throw new Error(
      `Workflow "${definition.id}": startNodeId "${definition.startNodeId}" does not reference an existing node`,
    );
  }

  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(
        `Workflow "${definition.id}": edge "${edge.id ?? `${edge.from}->${edge.to}`}" references unknown "from" node "${edge.from}"`,
      );
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(
        `Workflow "${definition.id}": edge "${edge.id ?? `${edge.from}->${edge.to}`}" references unknown "to" node "${edge.to}"`,
      );
    }
  }
}
