import { describe, expect, it } from "vitest";
import type { ExpressionContext } from "./context.js";
import { ExpressionSyntaxError } from "./errors.js";
import { hasTemplate, interpolate, interpolateString } from "./interpolate.js";

describe("hasTemplate", () => {
  it("detects a template block", () => {
    expect(hasTemplate("{{ global.baseUrl }}")).toBe(true);
    expect(hasTemplate("prefix {{ item.price }} suffix")).toBe(true);
  });

  it("returns false when there is no template block", () => {
    expect(hasTemplate("plain string")).toBe(false);
    expect(hasTemplate("")).toBe(false);
    expect(hasTemplate("{ not a template }")).toBe(false);
  });
});

describe("interpolateString - single full-string template preserves type", () => {
  const context: ExpressionContext = {
    global: { targetPrice: 100, baseUrl: "https://example.com", flag: true },
    item: { price: 50, available: true, tags: ["a", "b"] },
    actions: { extract: { output: { value: null } } },
  };

  it("preserves a number", () => {
    expect(interpolateString("{{ global.targetPrice }}", context)).toBe(100);
  });

  it("preserves a boolean", () => {
    expect(interpolateString("{{ item.available }}", context)).toBe(true);
  });

  it("preserves a string", () => {
    expect(interpolateString("{{ global.baseUrl }}", context)).toBe("https://example.com");
  });

  it("preserves an object/array", () => {
    expect(interpolateString("{{ item.tags }}", context)).toEqual(["a", "b"]);
  });

  it("preserves null", () => {
    expect(interpolateString("{{ actions.extract.output.value }}", context)).toBeNull();
  });

  it("preserves undefined for an unresolved path", () => {
    expect(interpolateString("{{ global.doesNotExist }}", context)).toBeUndefined();
  });

  it("tolerates surrounding whitespace around the whole template", () => {
    expect(interpolateString("   {{ global.targetPrice }}   ", context)).toBe(100);
  });

  it("evaluates a full boolean expression, not just a bare path", () => {
    expect(interpolateString("{{ item.price < global.targetPrice }}", context)).toBe(true);
  });
});

describe("interpolateString - template embedded in a larger string", () => {
  const context: ExpressionContext = {
    global: { baseUrl: "https://example.com", targetPrice: 100 },
    item: { price: 50, available: true },
  };

  it("stringifies a single embedded block", () => {
    expect(interpolateString("URL: {{ global.baseUrl }}/path", context)).toBe("URL: https://example.com/path");
  });

  it("stringifies a numeric result inside a larger string", () => {
    expect(interpolateString("Price is {{ item.price }} dollars", context)).toBe("Price is 50 dollars");
  });

  it("stringifies a boolean result inside a larger string", () => {
    expect(interpolateString("Available: {{ item.available }}", context)).toBe("Available: true");
  });

  it("replaces every occurrence of multiple blocks", () => {
    expect(interpolateString("{{ item.price }} < {{ global.targetPrice }}", context)).toBe("50 < 100");
  });

  it("replaces an undefined result with an empty string", () => {
    expect(interpolateString("value=[{{ global.doesNotExist }}]", context)).toBe("value=[]");
  });

  it("returns a string unchanged when it has no template blocks", () => {
    expect(interpolateString("plain text", context)).toBe("plain text");
  });

  it("throws ExpressionSyntaxError when an embedded expression is malformed", () => {
    expect(() => interpolateString("{{ global.x; process.exit(1) }}", context)).toThrow(ExpressionSyntaxError);
  });
});

describe("interpolate - recursive traversal", () => {
  const context: ExpressionContext = {
    global: { targetPrice: 100 },
    item: { price: 50, available: true, name: "widget" },
  };

  it("interpolates a plain string value", () => {
    expect(interpolate("{{ item.name }}", context)).toBe("widget");
  });

  it("leaves non-string primitives untouched", () => {
    expect(interpolate(42, context)).toBe(42);
    expect(interpolate(true, context)).toBe(true);
    expect(interpolate(null, context)).toBeNull();
    expect(interpolate(undefined, context)).toBeUndefined();
  });

  it("leaves a Date instance untouched", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(interpolate(date, context)).toBe(date);
  });

  it("recurses into arrays, interpolating each element and preserving types", () => {
    const input = ["{{ item.name }}", "{{ item.price }}", "static", "{{ item.available }}"];
    expect(interpolate(input, context)).toEqual(["widget", 50, "static", true]);
  });

  it("recurses into plain objects, interpolating each value and leaving keys unchanged", () => {
    const input = {
      label: "Item: {{ item.name }}",
      price: "{{ item.price }}",
      meta: { available: "{{ item.available }}", count: 3 },
    };
    expect(interpolate(input, context)).toEqual({
      label: "Item: widget",
      price: 50,
      meta: { available: true, count: 3 },
    });
  });

  it("recurses into arrays of objects nested inside objects", () => {
    const input = {
      items: [{ name: "{{ item.name }}" }, { name: "static-name" }],
    };
    expect(interpolate(input, context)).toEqual({
      items: [{ name: "widget" }, { name: "static-name" }],
    });
  });
});
