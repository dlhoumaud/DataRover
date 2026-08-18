import { describe, expect, it } from "vitest";
import { resolvePath } from "./context.js";
import type { ExpressionContext } from "./context.js";

describe("resolvePath", () => {
  const context: ExpressionContext = {
    global: { baseUrl: "https://example.com", targetPrice: 100, flags: { active: true } },
    project: { name: "demo-project" },
    workflow: { id: "wf_1" },
    actions: {
      login: { output: { token: "abc123" } },
      extract: { output: { prices: [10, 20, 30], nested: { deep: { value: 42 } } } },
    },
    item: { price: 50, available: true, tags: ["a", "b", "c"] },
    runtime: { attempt: 3 },
  };

  it("resolves a single top-level key", () => {
    expect(resolvePath(context, "project")).toEqual({ name: "demo-project" });
  });

  it("resolves a simple nested path", () => {
    expect(resolvePath(context, "global.baseUrl")).toBe("https://example.com");
  });

  it("resolves a deeply nested path across multiple objects", () => {
    expect(resolvePath(context, "actions.login.output.token")).toBe("abc123");
  });

  it("resolves a path through an action's output into a nested object", () => {
    expect(resolvePath(context, "actions.extract.output.nested.deep.value")).toBe(42);
  });

  it("resolves a path rooted at `item`", () => {
    expect(resolvePath(context, "item.price")).toBe(50);
    expect(resolvePath(context, "item.available")).toBe(true);
  });

  it("resolves an array index at the end of a path", () => {
    expect(resolvePath(context, "actions.extract.output.prices[0]")).toBe(10);
    expect(resolvePath(context, "actions.extract.output.prices[2]")).toBe(30);
  });

  it("resolves an array index followed by more keys", () => {
    const withObjectsInArray: ExpressionContext = {
      actions: { extract: { output: { items: [{ name: "first" }, { name: "second" }] } } },
    };
    expect(resolvePath(withObjectsInArray, "actions.extract.output.items[1].name")).toBe("second");
  });

  it("resolves an item-rooted array index", () => {
    expect(resolvePath(context, "item.tags[1]")).toBe("b");
  });

  it("returns undefined for a missing top-level key", () => {
    expect(resolvePath(context, "doesNotExist")).toBeUndefined();
  });

  it("returns undefined for a missing nested key", () => {
    expect(resolvePath(context, "global.doesNotExist")).toBeUndefined();
  });

  it("returns undefined when traversing through a missing intermediate value", () => {
    expect(resolvePath(context, "global.doesNotExist.deeper.evenDeeper")).toBeUndefined();
  });

  it("returns undefined for an out-of-range array index", () => {
    expect(resolvePath(context, "actions.extract.output.prices[99]")).toBeUndefined();
  });

  it("returns undefined when indexing into a non-array value", () => {
    expect(resolvePath(context, "global.baseUrl[0]")).toBeUndefined();
  });

  it("returns undefined when accessing a key on a non-object value", () => {
    expect(resolvePath(context, "global.targetPrice.nope")).toBeUndefined();
  });

  it("returns undefined for an unknown action name", () => {
    expect(resolvePath(context, "actions.missingAction.output")).toBeUndefined();
  });

  it("returns undefined for a malformed path instead of throwing", () => {
    expect(() => resolvePath(context, "global..baseUrl")).not.toThrow();
    expect(resolvePath(context, "global..baseUrl")).toBeUndefined();
    expect(resolvePath(context, "")).toBeUndefined();
  });

  it("never throws for any input on an empty context", () => {
    expect(() => resolvePath({}, "actions.login.output.token")).not.toThrow();
    expect(resolvePath({}, "actions.login.output.token")).toBeUndefined();
  });

  it("refuses to resolve prototype-chain keys instead of leaking a live object/function", () => {
    expect(resolvePath(context, "global.constructor")).toBeUndefined();
    expect(resolvePath(context, "global.constructor.constructor")).toBeUndefined();
    expect(resolvePath(context, "item.__proto__")).toBeUndefined();
    expect(resolvePath(context, "item.prototype")).toBeUndefined();
  });
});
