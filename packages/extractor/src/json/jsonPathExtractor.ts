import { JSONPath } from "jsonpath-plus";
import type {
  ExtractionOutcome,
  ExtractionRuleInput,
  SelectorScore,
} from "../types.js";

/**
 * Extracts a value from an arbitrary JS object (parsed JSON, or an object
 * produced from XML) using a fallback chain of JSONPath expressions.
 *
 * Expressions are tried in order; the first one that returns a non-empty
 * array of results is used to compute the returned value. Since JSONPath
 * expressions do not have a meaningful notion of "structural fragility" the
 * way CSS selectors do, every selector is scored 100 when it matched and 0
 * otherwise.
 */
export function extractWithJsonPath(
  data: unknown,
  rule: ExtractionRuleInput,
): ExtractionOutcome {
  const output = rule.output ?? "text";

  let matchedSelector: string | undefined;
  let matchedResults: unknown[] | undefined;
  const selectorScores: SelectorScore[] = [];

  for (const selector of rule.selectors) {
    let results: unknown[] = [];
    let matched = false;

    try {
      const raw: unknown = JSONPath({ path: selector, json: data as object });
      results = Array.isArray(raw) ? raw : [];
      matched = results.length > 0;
    } catch {
      matched = false;
    }

    selectorScores.push({
      selector,
      score: matched ? 100 : 0,
      matched,
    });

    if (matched && matchedSelector === undefined) {
      matchedSelector = selector;
      matchedResults = results;
    }
  }

  if (matchedSelector === undefined || matchedResults === undefined) {
    return {
      name: rule.name,
      value: undefined,
      matchedSelector: undefined,
      selectorScores,
    };
  }

  const value = output === "list" ? matchedResults : matchedResults[0];

  return {
    name: rule.name,
    value,
    matchedSelector,
    selectorScores,
  };
}
