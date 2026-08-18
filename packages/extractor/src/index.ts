export * from "./types.js";
export * from "./html/selectorFallback.js";
export * from "./html/cssExtractor.js";
export * from "./json/jsonPathExtractor.js";
export * from "./xml/xmlExtractor.js";
export * from "./regex/regexExtractor.js";

import type { ExtractionOutcome, ExtractionRuleInput } from "./types.js";
import { extractWithCss } from "./html/cssExtractor.js";
import { extractWithJsonPath } from "./json/jsonPathExtractor.js";
import { extractWithXml } from "./xml/xmlExtractor.js";
import { extractWithRegex } from "./regex/regexExtractor.js";

/**
 * The kind of raw source document an extraction rule is run against.
 */
export type ExtractSourceType = "html" | "json" | "xml";

/**
 * Dispatches an extraction rule against a source document based on
 * `sourceType`, picking the right strategy-specific extractor:
 *
 * - "html": `extractWithCss`, or `extractWithRegex` when `rule.strategy` is "regex".
 * - "json": `extractWithJsonPath`, or `extractWithRegex` (against `JSON.stringify(source)`) when `rule.strategy` is "regex".
 * - "xml": `extractWithXml`, or `extractWithRegex` (against the raw XML string) when `rule.strategy` is "regex".
 *
 * `rule.strategy === "xpath"` is not supported yet and always throws.
 */
export function extract(
  source: unknown,
  sourceType: ExtractSourceType,
  rule: ExtractionRuleInput,
): ExtractionOutcome {
  if (rule.strategy === "xpath") {
    throw new Error("XPath strategy is not implemented yet (planned for V2)");
  }

  if (sourceType === "html") {
    if (typeof source !== "string") {
      throw new Error(
        'extract: "source" must be a string when sourceType is "html"',
      );
    }
    return rule.strategy === "regex"
      ? extractWithRegex(source, rule)
      : extractWithCss(source, rule);
  }

  if (sourceType === "json") {
    if (rule.strategy === "regex") {
      return extractWithRegex(JSON.stringify(source), rule);
    }
    return extractWithJsonPath(source, rule);
  }

  if (sourceType === "xml") {
    if (typeof source !== "string") {
      throw new Error(
        'extract: "source" must be a string when sourceType is "xml"',
      );
    }
    return rule.strategy === "regex"
      ? extractWithRegex(source, rule)
      : extractWithXml(source, rule);
  }

  throw new Error(
    `extract: unsupported sourceType "${sourceType as string}"`,
  );
}
