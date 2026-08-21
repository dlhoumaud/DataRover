import { describe, expect, it } from "vitest";
import type { ActionNode } from "@datarover/workflow-types";
import {
  extractTemplateQuery,
  getAvailableVariables,
  getNodeOutputVariables,
  insertTemplateVariable,
} from "./templateVariables";

describe("getNodeOutputVariables", () => {
  it("lists status/headers/body for an http node, in addition to the bare output", () => {
    const node: ActionNode = { id: "http1", name: "Fetch", type: "http", method: "GET", url: "", responseType: "json" };
    expect(getNodeOutputVariables(node).map((v) => v.path)).toEqual([
      "actions.http1.output",
      "actions.http1.output.status",
      "actions.http1.output.headers",
      "actions.http1.output.body",
    ]);
  });

  it("lists status/html for a browserAction node", () => {
    const node: ActionNode = {
      id: "browserAction1",
      name: "Nav",
      type: "browserAction",
      startUrl: "",
      steps: [{ type: "wait", ms: 100 }],
    };
    expect(getNodeOutputVariables(node).map((v) => v.path)).toEqual([
      "actions.browserAction1.output",
      "actions.browserAction1.output.status",
      "actions.browserAction1.output.html",
    ]);
  });

  it("lists one entry per rule name for an extract node", () => {
    const node: ActionNode = {
      id: "extract1",
      name: "Extract",
      type: "extract",
      source: "http1",
      sourceType: "html",
      rules: [
        { name: "title", strategy: "css", selectors: [".title"], output: "text" },
        { name: "price", strategy: "css", selectors: [".price"], output: "text" },
      ],
    };
    expect(getNodeOutputVariables(node).map((v) => v.path)).toEqual([
      "actions.extract1.output",
      "actions.extract1.output.title",
      "actions.extract1.output.price",
    ]);
  });

  it("lists stopped/reason for a stop node", () => {
    const node: ActionNode = { id: "stop1", name: "Stop", type: "stop" };
    expect(getNodeOutputVariables(node).map((v) => v.path)).toEqual([
      "actions.stop1.output",
      "actions.stop1.output.stopped",
      "actions.stop1.output.reason",
    ]);
  });

  it("has no drilled-down siblings for condition/dataTransform/textCrypto/loop", () => {
    const condition: ActionNode = { id: "condition1", name: "C", type: "condition", expression: "true" };
    const dataTransform: ActionNode = {
      id: "dt1",
      name: "DT",
      type: "dataTransform",
      input: "",
      inputType: "raw",
      operations: [{ type: "trim" }],
      outputType: "text",
    };
    expect(getNodeOutputVariables(condition).map((v) => v.path)).toEqual(["actions.condition1.output"]);
    expect(getNodeOutputVariables(dataTransform).map((v) => v.path)).toEqual(["actions.dt1.output"]);
  });

  it("uses workflow.<key> for setVariable nodes, not actions.<id>.output.<key>", () => {
    const node: ActionNode = {
      id: "setVariable1",
      name: "Set",
      type: "setVariable",
      variables: { pageCount: "10", hasNext: "true" },
    };
    expect(getNodeOutputVariables(node).map((v) => v.path)).toEqual(["workflow.pageCount", "workflow.hasNext"]);
  });
});

describe("getAvailableVariables", () => {
  const http: ActionNode = { id: "http1", name: "Fetch", type: "http", method: "GET", url: "", responseType: "json" };
  const setVar: ActionNode = { id: "setVariable1", name: "Set", type: "setVariable", variables: { count: "1" } };

  it("collects every node's variables except the one currently being edited", () => {
    const paths = getAvailableVariables({ nodes: [http, setVar], currentNodeId: "http1" }).map((v) => v.path);
    expect(paths).not.toContain("actions.http1.output");
    expect(paths).toContain("workflow.count");
  });

  it("includes global.<key> for every declared project variable", () => {
    const paths = getAvailableVariables({ nodes: [], globalVariableKeys: ["baseUrl", "apiKey"] }).map((v) => v.path);
    expect(paths).toEqual(["global.baseUrl", "global.apiKey"]);
  });

  it("includes item/runtime.* only when insideLoopBody is true", () => {
    expect(getAvailableVariables({ nodes: [] }).map((v) => v.path)).toEqual([]);
    const paths = getAvailableVariables({ nodes: [], insideLoopBody: true }).map((v) => v.path);
    expect(paths).toEqual(["item", "runtime.index", "runtime.isFirst", "runtime.isLast"]);
  });
});

describe("extractTemplateQuery", () => {
  it("returns null when there is no {{ before the cursor", () => {
    expect(extractTemplateQuery("hello world", 5)).toBeNull();
  });

  it("returns the partial text after an unclosed {{", () => {
    expect(extractTemplateQuery("hello {{ glob", 13)).toBe("glob");
  });

  it("returns an empty string right after typing {{", () => {
    expect(extractTemplateQuery("{{", 2)).toBe("");
  });

  it("returns null once the block is already closed before the cursor", () => {
    expect(extractTemplateQuery("{{ global.x }} rest", 19)).toBeNull();
  });

  it("uses the most recent {{ when there are several", () => {
    expect(extractTemplateQuery("{{ a }} and {{ b", 16)).toBe("b");
  });

  it("trims leading whitespace but not trailing (still-typing) content", () => {
    expect(extractTemplateQuery("{{   glob", 9)).toBe("glob");
  });
});

describe("insertTemplateVariable", () => {
  it("replaces the open block with {{ path }} and reports the new cursor position", () => {
    const result = insertTemplateVariable("hello {{ glob", 13, "global.baseUrl");
    expect(result.value).toBe("hello {{ global.baseUrl }}");
    expect(result.value.slice(0, result.cursor)).toBe("hello {{ global.baseUrl }}");
  });

  it("keeps text after the cursor intact", () => {
    const result = insertTemplateVariable("{{ gl and more text", 5, "global.x");
    expect(result.value).toBe("{{ global.x }} and more text");
  });

  it("throws when there is no open block before cursorIndex", () => {
    expect(() => insertTemplateVariable("no braces here", 5, "global.x")).toThrow();
  });
});
