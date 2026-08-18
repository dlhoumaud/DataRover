import type {
  ExtractionOutcome,
  ExtractionRuleInput,
  SelectorScore,
} from "../types.js";

/**
 * Runs a single regex pattern (no delimiters, e.g. `price:\\s*(\\d+)`)
 * against `text` and returns whether it matched, plus the value that
 * "output" should carry for a single match: the first capture group when the
 * pattern defines one, otherwise the full match.
 */
function matchOnce(
  pattern: string,
  text: string,
): { matched: boolean; value: string | undefined } {
  const regex = new RegExp(pattern);
  const match = regex.exec(text);
  if (match === null) {
    return { matched: false, value: undefined };
  }
  return { matched: true, value: match[1] !== undefined ? match[1] : match[0] };
}

/**
 * Runs a single regex pattern globally against `text` and collects every
 * match: the first capture group when the pattern defines one, otherwise the
 * full match, for each occurrence found.
 */
function matchAll(
  pattern: string,
  text: string,
): { matched: boolean; value: string[] } {
  const regex = new RegExp(pattern, "g");
  const values: string[] = [];
  let execResult: RegExpExecArray | null;

  while ((execResult = regex.exec(text)) !== null) {
    values.push(
      execResult[1] !== undefined ? execResult[1] : execResult[0],
    );
    if (execResult[0] === "") {
      regex.lastIndex += 1;
    }
  }

  return { matched: values.length > 0, value: values };
}

/**
 * Extracts a value from raw text using a fallback chain of regular
 * expression patterns (plain strings, without `/` delimiters).
 *
 * Patterns are tried in order; the first one that matches is used. When
 * `rule.output` is "list", each pattern is evaluated with the global flag
 * and every match is collected; otherwise only the first match is used.
 * Every selector is scored 100 when it matched and 0 otherwise.
 */
export function extractWithRegex(
  text: string,
  rule: ExtractionRuleInput,
): ExtractionOutcome {
  const output = rule.output ?? "text";
  const isList = output === "list";

  let matchedSelector: string | undefined;
  let matchedValue: unknown;
  const selectorScores: SelectorScore[] = [];

  for (const pattern of rule.selectors) {
    let matched = false;
    let value: unknown;

    try {
      if (isList) {
        const result = matchAll(pattern, text);
        matched = result.matched;
        value = result.value;
      } else {
        const result = matchOnce(pattern, text);
        matched = result.matched;
        value = result.value;
      }
    } catch {
      matched = false;
    }

    selectorScores.push({
      selector: pattern,
      score: matched ? 100 : 0,
      matched,
    });

    if (matched && matchedSelector === undefined) {
      matchedSelector = pattern;
      matchedValue = value;
    }
  }

  if (matchedSelector === undefined) {
    return {
      name: rule.name,
      value: undefined,
      matchedSelector: undefined,
      selectorScores,
    };
  }

  return {
    name: rule.name,
    value: matchedValue,
    matchedSelector,
    selectorScores,
  };
}
