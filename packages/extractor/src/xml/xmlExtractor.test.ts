import { describe, expect, it } from "vitest";
import type { ExtractionRuleInput } from "../types.js";
import { extractWithXml } from "./xmlExtractor.js";

const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <product id="p1">
    <name>Produit A</name>
    <price>10</price>
  </product>
  <product id="p2">
    <name>Produit B</name>
    <price>20</price>
  </product>
</catalog>`;

function rule(overrides: Partial<ExtractionRuleInput>): ExtractionRuleInput {
  return {
    name: "test-rule",
    strategy: "jsonpath",
    selectors: [],
    ...overrides,
  };
}

describe("extractWithXml", () => {
  it("parses the XML and returns the first matching value for a JSONPath selector", () => {
    const outcome = extractWithXml(
      CATALOG_XML,
      rule({ selectors: ["$.catalog.product[0].name"], output: "text" }),
    );

    expect(outcome.value).toBe("Produit A");
    expect(outcome.matchedSelector).toBe("$.catalog.product[0].name");
  });

  it('returns all matching values for output "list"', () => {
    const outcome = extractWithXml(
      CATALOG_XML,
      rule({ selectors: ["$.catalog.product[*].name"], output: "list" }),
    );

    expect(outcome.value).toEqual(["Produit A", "Produit B"]);
  });

  it("preserves XML attributes, reachable via the configured attribute prefix", () => {
    const outcome = extractWithXml(
      CATALOG_XML,
      rule({
        selectors: ["$.catalog.product[0]['attr_id']"],
        output: "text",
      }),
    );

    expect(outcome.value).toBe("p1");
  });

  it("reaches an attribute on a non-repeated (singular, not array-wrapped) element", () => {
    // Real bug found and fixed: fast-xml-parser's default "@_" attribute prefix collides with
    // jsonpath-plus's own "@" (current-node) sigil specifically when the parent resolves to a
    // single object rather than an array — `product[0]['@_id']` above never exercised that path.
    const outcome = extractWithXml(
      `<config version="2"><value>ok</value></config>`,
      rule({ selectors: ["$.config['attr_version']"], output: "text" }),
    );

    expect(outcome.value).toBe(2);
  });

  it("parses numeric tag values as numbers", () => {
    const outcome = extractWithXml(
      CATALOG_XML,
      rule({ selectors: ["$.catalog.product[1].price"], output: "text" }),
    );

    expect(outcome.value).toBe(20);
  });

  it("falls back to the next selector when the first path matches nothing", () => {
    const outcome = extractWithXml(
      CATALOG_XML,
      rule({
        selectors: ["$.catalog.doesNotExist[*]", "$.catalog.product[0].name"],
        output: "text",
      }),
    );

    expect(outcome.matchedSelector).toBe("$.catalog.product[0].name");
    expect(outcome.value).toBe("Produit A");
  });

  it("returns an undefined value and no matchedSelector when nothing matches", () => {
    const outcome = extractWithXml(
      CATALOG_XML,
      rule({ selectors: ["$.nope.a", "$.nope.b"], output: "text" }),
    );

    expect(outcome.value).toBeUndefined();
    expect(outcome.matchedSelector).toBeUndefined();
    expect(outcome.selectorScores.every((s) => !s.matched && s.score === 0)).toBe(
      true,
    );
  });
});
