import { describe, expect, it } from "vitest";
import { ActionNodeSchema } from "@datarover/workflow-types";
import type { ActionNode, WorkflowDefinition } from "@datarover/workflow-types";
import {
  autoLayout,
  createDefaultNode,
  definitionToFlow,
  flowToDefinition,
  generateNodeId,
} from "./workflowGraph";

/**
 * A realistic 5-node workflow covering every ActionNode type, wired with a
 * condition node that branches true/false to two different downstream
 * nodes. All node ids are generator-shaped (`${type}${n}`) so they would
 * also be valid inside `{{ }}` expressions.
 */
function buildDefinition(): WorkflowDefinition {
  const httpNode: ActionNode = {
    id: "http1",
    name: "Fetch Listing Page",
    type: "http",
    method: "GET",
    url: "https://example.com/listings",
    responseType: "html",
  };
  const extractNode: ActionNode = {
    id: "extract1",
    name: "Extract Price",
    type: "extract",
    source: "{{ http1.output }}",
    sourceType: "html",
    rules: [{ name: "price", strategy: "css", selectors: [".price"], output: "text" }],
  };
  const conditionNode: ActionNode = {
    id: "condition1",
    name: "Has Price?",
    type: "condition",
    expression: "{{ extract1.price }} != null",
  };
  const setVariableNode: ActionNode = {
    id: "setVariable1",
    name: "Store Price",
    type: "setVariable",
    variables: { lastPrice: "{{ extract1.price }}" },
  };
  const stopNode: ActionNode = {
    id: "stop1",
    name: "Stop",
    type: "stop",
    reason: "Done",
  };

  return {
    id: "wf1",
    name: "Price Watch",
    startNodeId: "http1",
    nodes: [httpNode, extractNode, conditionNode, setVariableNode, stopNode],
    edges: [
      { from: "http1", to: "extract1" },
      { from: "extract1", to: "condition1" },
      { from: "condition1", to: "setVariable1", branch: "true" },
      { from: "condition1", to: "stop1", branch: "false" },
      { from: "setVariable1", to: "stop1" },
    ],
  };
}

describe("definitionToFlow / flowToDefinition round trip", () => {
  it("reconstructs a structurally identical WorkflowDefinition", () => {
    const definition = buildDefinition();
    const { nodes, edges } = definitionToFlow(definition);

    const rebuilt = flowToDefinition({
      id: definition.id,
      name: definition.name,
      startNodeId: definition.startNodeId,
      nodes,
      edges,
    });

    expect(rebuilt.id).toBe(definition.id);
    expect(rebuilt.name).toBe(definition.name);
    expect(rebuilt.startNodeId).toBe(definition.startNodeId);
    expect(rebuilt.nodes).toEqual(definition.nodes);
    expect(rebuilt.edges).toEqual(definition.edges);
  });

  it("carries the domain node object through unchanged for every FlowNode", () => {
    const definition = buildDefinition();
    const { nodes } = definitionToFlow(definition);

    expect(nodes).toHaveLength(definition.nodes.length);
    for (const flowNode of nodes) {
      expect(flowNode.data.node).toEqual(
        definition.nodes.find((n) => n.id === flowNode.id),
      );
      expect(flowNode.type).toBe(flowNode.data.node.type);
    }
  });

  it("exposes the condition branch as both sourceHandle and label on the edge", () => {
    const definition = buildDefinition();
    const { edges } = definitionToFlow(definition);

    const trueEdge = edges.find((e) => e.source === "condition1" && e.target === "setVariable1");
    const falseEdge = edges.find((e) => e.source === "condition1" && e.target === "stop1");

    expect(trueEdge?.sourceHandle).toBe("true");
    expect(trueEdge?.label).toBe("true");
    expect(falseEdge?.sourceHandle).toBe("false");
    expect(falseEdge?.label).toBe("false");

    const plainEdge = edges.find((e) => e.source === "http1" && e.target === "extract1");
    expect(plainEdge?.sourceHandle).toBeUndefined();
    expect(plainEdge?.label).toBeUndefined();
  });
});

describe("generateNodeId", () => {
  it("returns the type name suffixed with 1 when no id of that type exists", () => {
    expect(generateNodeId("http", new Set())).toBe("http1");
    expect(generateNodeId("condition", new Set(["http1", "extract1"]))).toBe("condition1");
  });

  it("increments past every already-used suffix for that type", () => {
    const existing = new Set(["http1", "http2", "http4"]);
    // First unused integer suffix, scanning up from 1 — 3 is free even
    // though 4 is already taken.
    expect(generateNodeId("http", existing)).toBe("http3");
  });

  it("never produces punctuation, only letters/digits/underscore", () => {
    for (const type of ["http", "extract", "condition", "setVariable", "stop"] as const) {
      const id = generateNodeId(type, new Set());
      expect(id).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });

  it("is stable and unique across repeated calls against a growing id set", () => {
    const existingIds = new Set<string>();
    const generated: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = generateNodeId("setVariable", existingIds);
      expect(existingIds.has(id)).toBe(false);
      existingIds.add(id);
      generated.push(id);
    }
    expect(generated).toEqual(["setVariable1", "setVariable2", "setVariable3", "setVariable4", "setVariable5"]);
  });
});

describe("autoLayout", () => {
  it("produces a finite, defined position for every reachable node", () => {
    const definition = buildDefinition();
    const positions = autoLayout(definition);

    for (const node of definition.nodes) {
      const position = positions.get(node.id);
      expect(position).toBeDefined();
      expect(Number.isFinite(position?.x)).toBe(true);
      expect(Number.isFinite(position?.y)).toBe(true);
    }
  });

  it("places the start node at depth 0 and increases x with BFS depth", () => {
    const definition = buildDefinition();
    const positions = autoLayout(definition);

    expect(positions.get("http1")).toEqual({ x: 0, y: 0 });
    expect(positions.get("extract1")?.x).toBe(260);
    expect(positions.get("condition1")?.x).toBe(520);
    // setVariable1 and stop1 both sit one BFS layer past condition1.
    expect(positions.get("setVariable1")?.x).toBe(780);
    expect(positions.get("stop1")?.x).toBe(780);
  });

  it("gives siblings at the same depth distinct y offsets", () => {
    const definition = buildDefinition();
    const positions = autoLayout(definition);

    const setVariablePos = positions.get("setVariable1");
    const stopPos = positions.get("stop1");
    expect(setVariablePos?.y).not.toBe(stopPos?.y);
  });

  it("places an unreachable node after all reached nodes, at x = 0", () => {
    const definition = buildDefinition();
    const orphan: ActionNode = { id: "stop2", name: "Unreachable Stop", type: "stop" };
    const definitionWithOrphan: WorkflowDefinition = {
      ...definition,
      nodes: [...definition.nodes, orphan],
    };

    const reachablePositions = autoLayout(definition);
    const maxReachedY = Math.max(...Array.from(reachablePositions.values()).map((p) => p.y));

    const positions = autoLayout(definitionWithOrphan);
    const orphanPosition = positions.get("stop2");

    expect(orphanPosition).toBeDefined();
    expect(orphanPosition?.x).toBe(0);
    expect(orphanPosition?.y).toBeGreaterThan(maxReachedY);
  });
});

describe("createDefaultNode", () => {
  it.each(["http", "extract", "condition", "setVariable", "stop"] as const)(
    "produces a schema-valid node for type %s",
    (type) => {
      const node = createDefaultNode(type, `${type}Test`);
      expect(node.id).toBe(`${type}Test`);
      expect(node.type).toBe(type);
      expect(() => ActionNodeSchema.parse(node)).not.toThrow();
    },
  );
});
