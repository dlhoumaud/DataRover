/**
 * Builds a JSONPath expression (the same dialect `jsonpath-plus` already evaluates everywhere
 * else in this app — the `extract` node's "jsonpath" strategy, `dataTransform`'s `getPath`
 * operation, and now the JSON/XML preview's click-to-select) from a path of keys/indices, e.g.
 * `["items", 0, "price"]` → `$.items[0].price`. Unlike HTML's CSS selectors, a JSONPath into a
 * concrete document has no ambiguity to score — there is exactly one path to a given node, so this
 * (not a set of scored candidates) is what the preview tool computes on click.
 */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function buildJsonPath(segments: ReadonlyArray<string | number>): string {
  let path = "$";
  for (const segment of segments) {
    if (typeof segment === "number") {
      path += `[${segment}]`;
    } else if (IDENTIFIER_PATTERN.test(segment)) {
      path += `.${segment}`;
    } else {
      path += `[${JSON.stringify(segment)}]`;
    }
  }
  return path;
}
