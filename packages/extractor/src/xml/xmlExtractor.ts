import { XMLParser } from "fast-xml-parser";
import type { ExtractionOutcome, ExtractionRuleInput } from "../types.js";
import { extractWithJsonPath } from "../json/jsonPathExtractor.js";

/**
 * Real bug found and fixed: `fast-xml-parser`'s own default attribute prefix is `"@_"`, but
 * `jsonpath-plus` (which every JSONPath selector here goes through) treats a bare `@` specially
 * (its "current node" filter-expression sigil) — verified directly that `$.item['@_id']` throws
 * inside `jsonpath-plus` whenever `item` resolves to a single object rather than an array (an XML
 * element that doesn't repeat), regardless of dot or bracket selector syntax. The existing test
 * below only ever exercised a *repeated* element (`product[0]['@_id']`), which happens to sidestep
 * the bug entirely — array-indexed access never triggers it, only plain-object access does. A
 * prefix without `@` avoids the collision entirely, confirmed for both shapes.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "attr_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
});

/**
 * Extracts a value from an XML document by first parsing it into a plain JS
 * object (attributes are preserved, prefixed with `attr_`), then delegating to
 * {@link extractWithJsonPath} using `rule.selectors` as JSONPath expressions
 * evaluated against that object.
 */
export function extractWithXml(
  xml: string,
  rule: ExtractionRuleInput,
): ExtractionOutcome {
  const data: unknown = parser.parse(xml);
  return extractWithJsonPath(data, rule);
}
