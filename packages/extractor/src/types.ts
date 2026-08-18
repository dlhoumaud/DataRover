/**
 * Extraction strategies supported by the extractor package.
 *
 * - "css": CSS selectors evaluated against HTML via cheerio.
 * - "xpath": reserved for a future implementation (V2).
 * - "jsonpath": JSONPath expressions evaluated against JS objects (JSON/XML-derived).
 * - "regex": regular expression patterns evaluated against raw text.
 */
export type ExtractStrategy = "css" | "xpath" | "jsonpath" | "regex";

/**
 * Shape of the value an extraction rule should produce.
 *
 * - "text": trimmed text content of the first match.
 * - "attribute": the value of a specific attribute on the first match (HTML only).
 * - "list": an array of trimmed text values, one per match.
 * - "table": an array of row objects built from a `<table>` element (HTML only).
 * - "value": alias of "text" — a generic single scalar value.
 */
export type ExtractOutput = "text" | "attribute" | "list" | "table" | "value";

/**
 * Input describing a single extraction rule to run against a source document.
 */
export interface ExtractionRuleInput {
  /** Human-readable name identifying what this rule extracts (e.g. "price"). */
  name: string;
  /** Extraction strategy to use. */
  strategy: ExtractStrategy;
  /**
   * Ordered list of selectors (CSS selectors, JSONPath expressions, or regex
   * patterns depending on `strategy`) to try, in fallback order. The first
   * selector that produces a match is used to compute the final value.
   */
  selectors: string[];
  /** Attribute name to read when `output` is "attribute". */
  attribute?: string;
  /** Desired output shape. Defaults to "text" when omitted. */
  output?: ExtractOutput;
}

/**
 * Robustness score computed for a single selector, along with whether it
 * actually matched anything in the current document.
 */
export interface SelectorScore {
  /** The selector string this score refers to. */
  selector: string;
  /** Heuristic robustness score, clamped between 0 and 100. */
  score: number;
  /** Whether this selector matched at least one node/value in the document. */
  matched: boolean;
}

/**
 * Result of running an extraction rule against a document.
 */
export interface ExtractionOutcome {
  /** Name of the rule that produced this outcome (copied from the input rule). */
  name: string;
  /** Extracted value. `undefined` when no selector matched. */
  value: unknown;
  /** The selector that was actually used to produce `value`, if any matched. */
  matchedSelector?: string;
  /** Per-selector scoring/matching diagnostics, for every selector in the rule. */
  selectorScores: SelectorScore[];
}
