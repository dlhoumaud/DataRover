import { describe, expect, it } from "vitest";
import { EdgeSchema, WorkflowDefinitionSchema } from "./workflow";

describe("EdgeSchema", () => {
  it("parses a plain edge without a branch", () => {
    const result = EdgeSchema.parse({ from: "n1", to: "n2" });
    expect(result.branch).toBeUndefined();
  });

  it("parses an edge with a true/false branch", () => {
    expect(EdgeSchema.parse({ from: "n2", to: "n3", branch: "true" }).branch).toBe("true");
    expect(EdgeSchema.parse({ from: "n2", to: "n4", branch: "false" }).branch).toBe("false");
  });

  it("rejects an edge with an invalid branch value", () => {
    const result = EdgeSchema.safeParse({ from: "n2", to: "n3", branch: "maybe" });
    expect(result.success).toBe(false);
  });
});

describe("WorkflowDefinitionSchema", () => {
  const fullWorkflow = {
    id: "wf-1",
    name: "Scrape and branch",
    startNodeId: "fetch",
    nodes: [
      {
        id: "fetch",
        name: "Fetch listing page",
        type: "http",
        method: "GET",
        url: "https://example.com/listings",
      },
      {
        id: "extract",
        name: "Extract listings",
        type: "extract",
        source: "fetch",
        sourceType: "html",
        rules: [
          {
            name: "hasNext",
            strategy: "css",
            selectors: [".pagination .next"],
            output: "value",
          },
        ],
      },
      {
        id: "hasNextPage",
        name: "Has next page?",
        type: "condition",
        expression: "vars.hasNext === 'true'",
      },
      {
        id: "fetchNext",
        name: "Fetch next page",
        type: "http",
        method: "GET",
        url: "https://example.com/listings?page=2",
      },
      {
        id: "stop",
        name: "Stop",
        type: "stop",
        reason: "no more pages",
      },
    ],
    edges: [
      { from: "fetch", to: "extract" },
      { from: "extract", to: "hasNextPage" },
      { from: "hasNextPage", to: "fetchNext", branch: "true" },
      { from: "hasNextPage", to: "stop", branch: "false" },
    ],
  };

  it("parses a complete workflow with branching edges", () => {
    const result = WorkflowDefinitionSchema.parse(fullWorkflow);
    expect(result.nodes).toHaveLength(5);
    expect(result.edges).toHaveLength(4);

    const trueBranch = result.edges.find((e) => e.branch === "true");
    const falseBranch = result.edges.find((e) => e.branch === "false");
    expect(trueBranch?.to).toBe("fetchNext");
    expect(falseBranch?.to).toBe("stop");
  });

  it("defaults edges to an empty array when omitted", () => {
    const { edges: _edges, ...withoutEdges } = fullWorkflow;
    const result = WorkflowDefinitionSchema.parse(withoutEdges);
    expect(result.edges).toEqual([]);
  });

  it("rejects a workflow with an empty nodes array", () => {
    const invalid = { ...fullWorkflow, nodes: [] };
    expect(WorkflowDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a workflow containing a node with an unknown type", () => {
    const invalid = {
      ...fullWorkflow,
      nodes: [...fullWorkflow.nodes, { id: "bogus", name: "Bogus", type: "teleport" }],
    };
    expect(WorkflowDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a workflow missing a startNodeId", () => {
    const { startNodeId: _startNodeId, ...invalid } = fullWorkflow;
    expect(WorkflowDefinitionSchema.safeParse(invalid).success).toBe(false);
  });
});
