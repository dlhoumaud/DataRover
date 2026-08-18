import { XMLParser } from "fast-xml-parser";
import type { ExtractionOutcome, ExtractionRuleInput } from "../types.js";
import { extractWithJsonPath } from "../json/jsonPathExtractor.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
});

/**
 * Extracts a value from an XML document by first parsing it into a plain JS
 * object (attributes are preserved, prefixed with `@_`), then delegating to
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
