import type { WorkflowDefinition } from "@datarover/workflow-types";
import { describe, expect, it } from "vitest";
import { getNextNodeId, getNodeById, getOutgoingEdges, validateDefinition } from "./graph.js";

function buildDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "wf-1",
    name: "Test workflow",
    startNodeId: "cond",
    nodes: [
      { id: "cond", name: "Check price", type: "condition", expression: "item.price < 10" },
      { id: "cheap", name: "Cheap", type: "stop", reason: "cheap" },
      { id: "expensive", name: "Expensive", type: "stop", reason: "expensive" },
    ],
    edges: [
      { from: "cond", to: "cheap", branch: "true" },
      { from: "cond", to: "expensive", branch: "false" },
    ],
    ...overrides,
  };
}

describe("getNodeById", () => {
  it("returns the node matching the given id", () => {
    const definition = buildDefinition();
    const node = getNodeById(definition, "cond");
    expect(node.id).toBe("cond");
    expect(node.type).toBe("condition");
  });

  it("throws an explicit error when the node does not exist", () => {
    const definition = buildDefinition();
    expect(() => getNodeById(definition, "missing")).toThrow(/missing/);
  });
});

describe("getOutgoingEdges", () => {
  it("returns every edge whose from matches the given node id", () => {
    const definition = buildDefinition();
    expect(getOutgoingEdges(definition, "cond")).toHaveLength(2);
  });

  it("returns an empty array when the node has no outgoing edges", () => {
    const definition = buildDefinition();
    expect(getOutgoingEdges(definition, "cheap")).toEqual([]);
  });
});

describe("getNextNodeId", () => {
  it("follows the true branch of a condition node", () => {
    const definition = buildDefinition();
    expect(getNextNodeId(definition, "cond", "true")).toBe("cheap");
  });

  it("follows the false branch of a condition node", () => {
    const definition = buildDefinition();
    expect(getNextNodeId(definition, "cond", "false")).toBe("expensive");
  });

  it("returns undefined when no outgoing edge matches the requested branch", () => {
    const definition = buildDefinition({
      edges: [{ from: "cond", to: "cheap", branch: "true" }],
    });
    expect(getNextNodeId(definition, "cond", "false")).toBeUndefined();
  });

  it("follows the single unconditional outgoing edge of a non-condition node", () => {
    const definition = buildDefinition({
      edges: [
        { from: "cond", to: "cheap", branch: "true" },
        { from: "cond", to: "expensive", branch: "false" },
        { from: "cheap", to: "expensive" },
      ],
    });
    expect(getNextNodeId(definition, "cheap")).toBe("expensive");
  });

  it("returns undefined at the natural end of the graph", () => {
    const definition = buildDefinition({
      edges: [{ from: "cond", to: "cheap", branch: "true" }],
    });
    expect(getNextNodeId(definition, "cheap")).toBeUndefined();
  });
});

describe("validateDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(() => validateDefinition(buildDefinition())).not.toThrow();
  });

  it("rejects a definition whose startNodeId does not reference an existing node", () => {
    const definition = buildDefinition({ startNodeId: "does-not-exist" });
    expect(() => validateDefinition(definition)).toThrow(/does-not-exist/);
  });

  it(`rejects a definition with an edge referencing an unknown "from" node`, () => {
    const definition = buildDefinition({
      edges: [{ from: "unknown-node", to: "cheap", branch: "true" }],
    });
    expect(() => validateDefinition(definition)).toThrow(/unknown-node/);
  });

  it(`rejects a definition with an edge referencing an unknown "to" node`, () => {
    const definition = buildDefinition({
      edges: [{ from: "cond", to: "unknown-node", branch: "true" }],
    });
    expect(() => validateDefinition(definition)).toThrow(/unknown-node/);
  });
});
