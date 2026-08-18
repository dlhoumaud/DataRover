import { createServer } from "node:http";
import type { Server } from "node:http";
import type { WorkflowDefinition } from "@datarover/workflow-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkflowEngine } from "./engine.js";

describe("WorkflowEngine integration", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/products") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            products: [
              { name: "Produit A", price: 19.99 },
              { name: "Produit B", price: 49.99 },
            ],
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Failed to determine the test server's ephemeral port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("runs a fetch -> extract -> condition workflow end to end", async () => {
    const definition: WorkflowDefinition = {
      id: "wf-products",
      name: "Fetch products and check price",
      startNodeId: "fetchProducts",
      nodes: [
        {
          id: "fetchProducts",
          name: "Fetch products",
          type: "http",
          method: "GET",
          url: "{{ global.baseUrl }}/products",
          responseType: "json",
        },
        {
          id: "extract",
          name: "Extract first price",
          type: "extract",
          source: "fetchProducts",
          sourceType: "json",
          rules: [
            {
              name: "firstPrice",
              strategy: "jsonpath",
              selectors: ["$.products[0].price"],
              output: "value",
            },
          ],
        },
        {
          id: "checkPrice",
          name: "Check price is under 30",
          type: "condition",
          expression: "actions.extract.output.firstPrice < 30",
        },
      ],
      edges: [
        { from: "fetchProducts", to: "extract" },
        { from: "extract", to: "checkPrice" },
      ],
    };

    const engine = new WorkflowEngine();
    const events: string[] = [];
    const execution = await engine.run(definition, {
      variables: { global: { baseUrl } },
      onEvent: (event) => {
        events.push(event.type);
      },
    });

    expect(execution.status).toBe("success");
    expect(execution.error).toBeUndefined();
    expect(execution.actionResults).toHaveLength(3);
    for (const result of execution.actionResults) {
      expect(result.status).toBe("success");
    }

    const fetchResult = execution.actionResults.find((result) => result.nodeId === "fetchProducts");
    const extractResult = execution.actionResults.find((result) => result.nodeId === "extract");
    const conditionResult = execution.actionResults.find((result) => result.nodeId === "checkPrice");

    expect(fetchResult).toBeDefined();
    expect(fetchResult?.output).toMatchObject({ status: 200 });

    expect(extractResult?.output).toEqual({ firstPrice: 19.99 });

    // 19.99 < 30 => the condition node evaluates truthy: it took the "true" branch.
    expect(conditionResult?.output).toBe(true);

    expect(events).toContain("started");
    expect(events).toContain("completed");
    expect(events.filter((type) => type === "action-started")).toHaveLength(3);
    expect(events.filter((type) => type === "action-completed")).toHaveLength(3);
  });

  it("fetches an item priced above the threshold and takes the false branch", async () => {
    const definition: WorkflowDefinition = {
      id: "wf-products-2",
      name: "Fetch products and check price (second item)",
      startNodeId: "fetchProducts",
      nodes: [
        {
          id: "fetchProducts",
          name: "Fetch products",
          type: "http",
          method: "GET",
          url: "{{ global.baseUrl }}/products",
          responseType: "json",
        },
        {
          id: "extract",
          name: "Extract second price",
          type: "extract",
          source: "fetchProducts",
          sourceType: "json",
          rules: [
            {
              name: "secondPrice",
              strategy: "jsonpath",
              selectors: ["$.products[1].price"],
              output: "value",
            },
          ],
        },
        {
          id: "checkPrice",
          name: "Check price is under 30",
          type: "condition",
          expression: "actions.extract.output.secondPrice < 30",
        },
      ],
      edges: [
        { from: "fetchProducts", to: "extract" },
        { from: "extract", to: "checkPrice" },
      ],
    };

    const engine = new WorkflowEngine();
    const execution = await engine.run(definition, {
      variables: { global: { baseUrl } },
    });

    expect(execution.status).toBe("success");
    expect(execution.actionResults).toHaveLength(3);

    const extractResult = execution.actionResults.find((result) => result.nodeId === "extract");
    const conditionResult = execution.actionResults.find((result) => result.nodeId === "checkPrice");

    expect(extractResult?.output).toEqual({ secondPrice: 49.99 });
    // 49.99 < 30 => false: the condition node evaluates falsy.
    expect(conditionResult?.output).toBe(false);
  });

  it("marks the execution as failed when an http node targets an unreachable server", async () => {
    const definition: WorkflowDefinition = {
      id: "wf-failure",
      name: "Unreachable target",
      startNodeId: "fetchProducts",
      nodes: [
        {
          id: "fetchProducts",
          name: "Fetch products",
          type: "http",
          method: "GET",
          url: "http://127.0.0.1:1/unreachable",
          responseType: "json",
          timeoutMs: 200,
        },
      ],
      edges: [],
    };

    const engine = new WorkflowEngine();
    const execution = await engine.run(definition);

    expect(execution.status).toBe("failed");
    expect(execution.error).toBeDefined();
    expect(execution.actionResults).toHaveLength(1);
    expect(execution.actionResults[0]?.status).toBe("failed");
  });
});
