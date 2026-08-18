import { describe, expect, it } from "vitest";
import type { ExtractionRuleInput } from "../types.js";
import { extractWithRegex } from "./regexExtractor.js";

const PRODUCT_TEXT =
  "Name: Produit A, Price: 42.50 EUR, Stock: 12 units, SKU: ABC-123";

const LIST_TEXT = "Item1: 10, Item2: 20, Item3: 30";

function rule(overrides: Partial<ExtractionRuleInput>): ExtractionRuleInput {
  return {
    name: "test-rule",
    strategy: "regex",
    selectors: [],
    ...overrides,
  };
}

describe("extractWithRegex", () => {
  it("returns the first capture group of the first match by default", () => {
    const outcome = extractWithRegex(
      PRODUCT_TEXT,
      rule({ selectors: ["Price:\\s*([\\d.]+)"], output: "text" }),
    );

    expect(outcome.value).toBe("42.50");
    expect(outcome.matchedSelector).toBe("Price:\\s*([\\d.]+)");
  });

  it("returns the full match when the pattern has no capture group", () => {
    const outcome = extractWithRegex(
      PRODUCT_TEXT,
      rule({ selectors: ["SKU: [A-Z0-9-]+"], output: "text" }),
    );

    expect(outcome.value).toBe("SKU: ABC-123");
  });

  it('collects every capture-group match for output "list"', () => {
    const outcome = extractWithRegex(
      LIST_TEXT,
      rule({ selectors: ["Item\\d+: (\\d+)"], output: "list" }),
    );

    expect(outcome.value).toEqual(["10", "20", "30"]);
  });

  it('collects every full match for output "list" when there is no capture group', () => {
    const outcome = extractWithRegex(
      "Values: 10, 20, 30",
      rule({ selectors: ["\\d+"], output: "list" }),
    );

    expect(outcome.value).toEqual(["10", "20", "30"]);
  });

  it("falls back to the next pattern when the first one is an invalid regex", () => {
    const outcome = extractWithRegex(
      PRODUCT_TEXT,
      rule({
        selectors: ["[unterminated-class", "Price:\\s*([\\d.]+)"],
        output: "text",
      }),
    );

    expect(outcome.matchedSelector).toBe("Price:\\s*([\\d.]+)");
    expect(outcome.value).toBe("42.50");
    expect(outcome.selectorScores).toEqual([
      { selector: "[unterminated-class", score: 0, matched: false },
      { selector: "Price:\\s*([\\d.]+)", score: 100, matched: true },
    ]);
  });

  it("falls back to the next pattern when the first one does not match", () => {
    const outcome = extractWithRegex(
      PRODUCT_TEXT,
      rule({
        selectors: ["Weight:\\s*(\\d+)", "Stock:\\s*(\\d+)"],
        output: "text",
      }),
    );

    expect(outcome.matchedSelector).toBe("Stock:\\s*(\\d+)");
    expect(outcome.value).toBe("12");
  });

  it("returns an undefined value and no matchedSelector when nothing matches", () => {
    const outcome = extractWithRegex(
      PRODUCT_TEXT,
      rule({ selectors: ["Weight:\\s*(\\d+)", "Volume:\\s*(\\d+)"] }),
    );

    expect(outcome.value).toBeUndefined();
    expect(outcome.matchedSelector).toBeUndefined();
    expect(outcome.selectorScores).toEqual([
      { selector: "Weight:\\s*(\\d+)", score: 0, matched: false },
      { selector: "Volume:\\s*(\\d+)", score: 0, matched: false },
    ]);
  });
});
