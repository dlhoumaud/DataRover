import { describe, expect, it } from "vitest";
import type { ExtractionRuleInput } from "../types.js";
import { extractWithCss } from "./cssExtractor.js";

const PRODUCT_LIST_HTML = `
<!doctype html>
<html>
  <body>
    <div id="catalog">
      <div class="product-card">
        <span class="title">Produit A</span>
        <span class="price" data-testid="price">10€</span>
      </div>
      <div class="product-card">
        <span class="title">Produit B</span>
        <span class="price" data-testid="price">20€</span>
      </div>
      <div class="product-card">
        <span class="title">Produit C</span>
        <span class="price" data-testid="price">30€</span>
      </div>
    </div>
  </body>
</html>
`;

const TABLE_HTML = `
<table id="rates">
  <thead>
    <tr><th>Currency</th><th>Rate</th></tr>
  </thead>
  <tbody>
    <tr><td>EUR</td><td>1.00</td></tr>
    <tr><td>USD</td><td>1.09</td></tr>
  </tbody>
</table>
`;

function rule(overrides: Partial<ExtractionRuleInput>): ExtractionRuleInput {
  return {
    name: "test-rule",
    strategy: "css",
    selectors: [],
    ...overrides,
  };
}

describe("extractWithCss", () => {
  it('extracts the trimmed text of the first match for output "text"', () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({ selectors: [".product-card .title"], output: "text" }),
    );

    expect(outcome.value).toBe("Produit A");
    expect(outcome.matchedSelector).toBe(".product-card .title");
    expect(outcome.name).toBe("test-rule");
  });

  it('defaults to "text" output when none is provided', () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({ selectors: [".product-card .title"] }),
    );

    expect(outcome.value).toBe("Produit A");
  });

  it('extracts an array of trimmed texts for all matches for output "list"', () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({ selectors: [".product-card .title"], output: "list" }),
    );

    expect(outcome.value).toEqual(["Produit A", "Produit B", "Produit C"]);
  });

  it('extracts an attribute value for output "attribute"', () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({
        selectors: [".product-card .price"],
        output: "attribute",
        attribute: "data-testid",
      }),
    );

    expect(outcome.value).toBe("price");
  });

  it('throws an explicit error for output "attribute" without an attribute name', () => {
    expect(() =>
      extractWithCss(
        PRODUCT_LIST_HTML,
        rule({ selectors: [".product-card .price"], output: "attribute" }),
      ),
    ).toThrow(/attribute/i);
  });

  it("falls back to the next selector when the first one is invalid", () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({
        selectors: ["[[[invalid-selector", ".product-card .title"],
        output: "text",
      }),
    );

    expect(outcome.matchedSelector).toBe(".product-card .title");
    expect(outcome.value).toBe("Produit A");
    expect(outcome.selectorScores).toHaveLength(2);
    expect(outcome.selectorScores[0]).toMatchObject({
      selector: "[[[invalid-selector",
      matched: false,
    });
    expect(outcome.selectorScores[1]).toMatchObject({
      selector: ".product-card .title",
      matched: true,
    });
  });

  it("falls back to the next selector when the first one matches nothing", () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({
        selectors: [".does-not-exist", ".product-card .title"],
        output: "text",
      }),
    );

    expect(outcome.matchedSelector).toBe(".product-card .title");
    expect(outcome.value).toBe("Produit A");
  });

  it("returns an undefined value and no matchedSelector when nothing matches", () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({ selectors: [".does-not-exist", "#neither"], output: "text" }),
    );

    expect(outcome.value).toBeUndefined();
    expect(outcome.matchedSelector).toBeUndefined();
    expect(outcome.selectorScores).toHaveLength(2);
    expect(outcome.selectorScores.every((s) => !s.matched)).toBe(true);
  });

  it('builds an array of row objects for output "table"', () => {
    const outcome = extractWithCss(
      TABLE_HTML,
      rule({ selectors: ["#rates"], output: "table" }),
    );

    expect(outcome.value).toEqual([
      { Currency: "EUR", Rate: "1.00" },
      { Currency: "USD", Rate: "1.09" },
    ]);
  });

  it('computes selectorScores for every selector regardless of which one is used', () => {
    const outcome = extractWithCss(
      PRODUCT_LIST_HTML,
      rule({
        selectors: [
          "#catalog .product-card .title",
          ".product-card .title",
          "#catalog > div:nth-child(1) > span:nth-child(1)",
        ],
        output: "text",
      }),
    );

    expect(outcome.selectorScores).toHaveLength(3);
    expect(outcome.selectorScores.map((s) => s.matched)).toEqual([
      true,
      true,
      true,
    ]);
    // The first selector in the list wins even though later selectors also match.
    expect(outcome.matchedSelector).toBe("#catalog .product-card .title");
  });
});
