import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  ExtractionOutcome,
  ExtractionRuleInput,
  SelectorScore,
} from "../types.js";
import { scoreSelector } from "./selectorFallback.js";

type CheerioSelection = Cheerio<AnyNode>;

/**
 * Builds the `{ header: cellText }` rows of a `<table>` element. Uses
 * `thead th` as headers when present, otherwise falls back to the first
 * `<tr>` of the table. Rows that themselves contain `<th>` cells (and are
 * therefore acting as header rows) are excluded from the data rows when no
 * explicit `<thead>` is used.
 */
function extractTableRows(
  $: CheerioAPI,
  $table: CheerioSelection,
): Array<Record<string, string>> {
  const theadHeaderCells = $table.find("thead th");

  let headers: string[];
  let dataRows: CheerioSelection;

  if (theadHeaderCells.length > 0) {
    headers = theadHeaderCells
      .map((_, el) => $(el).text().trim())
      .get() as string[];

    const tbodyRows = $table.find("tbody tr");
    dataRows =
      tbodyRows.length > 0
        ? tbodyRows
        : $table.find("tr").filter((_, tr) => $(tr).find("th").length === 0);
  } else {
    const allRows = $table.find("tr");
    const headerRow = allRows.first();
    headers = headerRow
      .find("th, td")
      .map((_, el) => $(el).text().trim())
      .get() as string[];
    dataRows = allRows.slice(1);
  }

  const rows: Array<Record<string, string>> = [];
  dataRows.each((_, tr) => {
    const cells = $(tr).find("td, th");
    const row: Record<string, string> = {};
    cells.each((cellIndex, cell) => {
      const header = headers[cellIndex] ?? `column${cellIndex}`;
      row[header] = $(cell).text().trim();
    });
    rows.push(row);
  });

  return rows;
}

/**
 * Extracts a value from an HTML document using a fallback chain of CSS
 * selectors evaluated with cheerio.
 *
 * Selectors are tried in order; the first one that matches at least one
 * element in the document is used to compute the returned value.
 * `selectorScores` is populated for every selector in `rule.selectors`,
 * regardless of which one ends up being used.
 */
export function extractWithCss(
  html: string,
  rule: ExtractionRuleInput,
): ExtractionOutcome {
  const $ = cheerio.load(html);
  const output = rule.output ?? "text";

  let matchedSelector: string | undefined;
  let matchedElements: CheerioSelection | undefined;
  const selectorScores: SelectorScore[] = [];

  for (const selector of rule.selectors) {
    let elements: CheerioSelection | undefined;
    let matched = false;

    try {
      elements = $(selector);
      matched = elements.length > 0;
    } catch {
      matched = false;
    }

    selectorScores.push({
      selector,
      score: scoreSelector(selector),
      matched,
    });

    if (matched && matchedSelector === undefined && elements) {
      matchedSelector = selector;
      matchedElements = elements;
    }
  }

  if (matchedSelector === undefined || matchedElements === undefined) {
    return {
      name: rule.name,
      value: undefined,
      matchedSelector: undefined,
      selectorScores,
    };
  }

  let value: unknown;

  switch (output) {
    case "text":
    case "value": {
      value = matchedElements.first().text().trim();
      break;
    }
    case "attribute": {
      if (!rule.attribute) {
        throw new Error(
          `extractWithCss: rule "${rule.name}" has output "attribute" but no "attribute" was provided`,
        );
      }
      const attrValue = matchedElements.first().attr(rule.attribute);
      value = typeof attrValue === "string" ? attrValue.trim() : attrValue;
      break;
    }
    case "list": {
      value = matchedElements
        .map((_, el) => $(el).text().trim())
        .get() as string[];
      break;
    }
    case "table": {
      const $table = matchedElements.first().is("table")
        ? matchedElements.first()
        : matchedElements.first().find("table").first();
      value = extractTableRows($, $table);
      break;
    }
    default: {
      const exhaustiveCheck: never = output;
      throw new Error(
        `extractWithCss: unsupported output "${exhaustiveCheck as string}"`,
      );
    }
  }

  return {
    name: rule.name,
    value,
    matchedSelector,
    selectorScores,
  };
}
