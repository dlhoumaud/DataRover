import { describe, expect, it } from "vitest";
import type { ExtractionRuleInput } from "../types.js";
import { extractWithJsonPath } from "./jsonPathExtractor.js";

const CATALOG_DATA = {
  store: {
    products: [
      { name: "Produit A", price: 10 },
      { name: "Produit B", price: 20 },
      { name: "Produit C", price: 30 },
    ],
  },
};

function rule(overrides: Partial<ExtractionRuleInput>): ExtractionRuleInput {
  return {
    name: "test-rule",
    strategy: "jsonpath",
    selectors: [],
    ...overrides,
  };
}

describe("extractWithJsonPath", () => {
  it('returns the first matching value for output "text"', () => {
    const outcome = extractWithJsonPath(
      CATALOG_DATA,
      rule({ selectors: ["$.store.products[0].name"], output: "text" }),
    );

    expect(outcome.value).toBe("Produit A");
    expect(outcome.matchedSelector).toBe("$.store.products[0].name");
  });

  it('defaults to returning the first value when output is omitted', () => {
    const outcome = extractWithJsonPath(
      CATALOG_DATA,
      rule({ selectors: ["$.store.products[0].price"] }),
    );

    expect(outcome.value).toBe(10);
  });

  it('returns the full result array for output "list"', () => {
    const outcome = extractWithJsonPath(
      CATALOG_DATA,
      rule({ selectors: ["$.store.products[*].name"], output: "list" }),
    );

    expect(outcome.value).toEqual(["Produit A", "Produit B", "Produit C"]);
  });

  it('returns the first result even for output "attribute" (JSON has no attribute concept)', () => {
    const outcome = extractWithJsonPath(
      CATALOG_DATA,
      rule({ selectors: ["$.store.products[*].name"], output: "attribute" }),
    );

    expect(outcome.value).toBe("Produit A");
  });

  it("falls back to the next selector when the first path matches nothing", () => {
    const outcome = extractWithJsonPath(
      CATALOG_DATA,
      rule({
        selectors: ["$.store.doesNotExist[*]", "$.store.products[0].name"],
        output: "text",
      }),
    );

    expect(outcome.matchedSelector).toBe("$.store.products[0].name");
    expect(outcome.value).toBe("Produit A");
    expect(outcome.selectorScores).toEqual([
      { selector: "$.store.doesNotExist[*]", score: 0, matched: false },
      { selector: "$.store.products[0].name", score: 100, matched: true },
    ]);
  });

  it("returns an undefined value and no matchedSelector when nothing matches", () => {
    const outcome = extractWithJsonPath(
      CATALOG_DATA,
      rule({
        selectors: ["$.nope.a", "$.nope.b"],
        output: "text",
      }),
    );

    expect(outcome.value).toBeUndefined();
    expect(outcome.matchedSelector).toBeUndefined();
    expect(outcome.selectorScores).toEqual([
      { selector: "$.nope.a", score: 0, matched: false },
      { selector: "$.nope.b", score: 0, matched: false },
    ]);
  });
});
