import { XMLParser } from "fast-xml-parser";
import { JSONPath } from "jsonpath-plus";
import { parse as parseYaml } from "yaml";
import { interpolate } from "@datarover/expression-engine";
import type { DataOutputType, DataTransformNode, DataTransformOperation } from "@datarover/workflow-types";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

/**
 * Same options as @datarover/extractor's xmlExtractor.ts, so a `dataTransform` node parses XML
 * into exactly the same object shape an `extract` node would — including the `attr_` attribute
 * prefix (not `fast-xml-parser`'s own default, `"@_"`): a bare `@` collides with `jsonpath-plus`'s
 * "current node" sigil, breaking `getPath` on an attribute of any XML element that doesn't repeat
 * (verified directly, and fixed the same way in xmlExtractor.ts — see its comment for detail).
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "attr_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
});

function toStringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

function toIntValue(value: unknown): number {
  return Math.trunc(Number(typeof value === "string" ? value.trim() : value));
}

function toFloatValue(value: unknown): number {
  return Number(typeof value === "string" ? value.trim() : value);
}

const TRUE_STRINGS = new Set(["true", "1", "yes", "oui"]);
const FALSE_STRINGS = new Set(["false", "0", "no", "non", ""]);

function toBooleanValue(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (FALSE_STRINGS.has(normalized)) {
      return false;
    }
    if (TRUE_STRINGS.has(normalized)) {
      return true;
    }
  }
  return Boolean(value);
}

/**
 * Parses `interpolated` into the shape `inputType` implies. If it's already a non-string value
 * (an upstream `http` node with `responseType: "json"` hands downstream nodes an already-parsed
 * object/array, never a re-encoded string — see httpExecutor.ts), it's used as-is: only a plain
 * string gets actually parsed.
 */
function parseInput(interpolated: unknown, inputType: DataTransformNode["inputType"]): unknown {
  if (inputType === "raw") {
    return typeof interpolated === "string" ? interpolated : interpolated == null ? "" : String(interpolated);
  }
  if (typeof interpolated !== "string") {
    return interpolated;
  }
  switch (inputType) {
    case "json":
      return JSON.parse(interpolated);
    case "yaml":
      return parseYaml(interpolated);
    case "xml":
      return xmlParser.parse(interpolated);
    default: {
      const exhaustiveCheck: never = inputType;
      throw new Error(`Unsupported input type: ${String(exhaustiveCheck)}`);
    }
  }
}

function applyOperation(value: unknown, operation: DataTransformOperation): unknown {
  switch (operation.type) {
    case "lower":
      return toStringValue(value).toLowerCase();
    case "upper":
      return toStringValue(value).toUpperCase();
    case "capitalize": {
      const text = toStringValue(value);
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    case "replace": {
      const text = toStringValue(value);
      return operation.all
        ? text.split(operation.search).join(operation.replacement)
        : text.replace(operation.search, operation.replacement);
    }
    case "regexReplace":
      return toStringValue(value).replace(new RegExp(operation.pattern, operation.flags), operation.replacement);
    case "slice":
      return toStringValue(value).slice(operation.start, operation.end);
    case "trim":
      return toStringValue(value).trim();
    case "trimStart":
      return toStringValue(value).trimStart();
    case "trimEnd":
      return toStringValue(value).trimEnd();
    case "padStart":
      return toStringValue(value).padStart(operation.length, operation.char);
    case "padEnd":
      return toStringValue(value).padEnd(operation.length, operation.char);

    case "getPath": {
      if (value === null || typeof value !== "object") {
        return undefined;
      }
      const results: unknown = JSONPath({ path: operation.path, json: value });
      return Array.isArray(results) ? results[0] : undefined;
    }
    case "keys":
      return value !== null && typeof value === "object" ? Object.keys(value) : [];
    case "values":
      return value !== null && typeof value === "object" ? Object.values(value) : [];
    case "toArray":
      return Array.isArray(value) ? value : [value];
    case "length": {
      if (Array.isArray(value) || typeof value === "string") {
        return value.length;
      }
      if (value !== null && typeof value === "object") {
        return Object.keys(value).length;
      }
      return 0;
    }
    case "stringify":
      return JSON.stringify(value);

    case "toInt":
      return toIntValue(value);
    case "toFloat":
      return toFloatValue(value);
    case "toBoolean":
      return toBooleanValue(value);

    default: {
      const exhaustiveCheck: never = operation;
      throw new Error(`Unsupported data transform operation: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Normalizes whatever the pipeline produced to exactly `outputType`, regardless of what the last
 * operation's natural result happened to be — this is what makes a declared `outputType`
 * trustworthy even after an operation whose result shape isn't statically knowable (`getPath`
 * into an arbitrary document).
 */
function coerceToOutputType(value: unknown, outputType: DataOutputType): unknown {
  switch (outputType) {
    case "text":
      return toStringValue(value);
    case "int":
      return toIntValue(value);
    case "float":
      return toFloatValue(value);
    case "boolean":
      return toBooleanValue(value);
    case "list":
      return Array.isArray(value) ? value : [value];
    case "table": {
      if (Array.isArray(value)) {
        return value.map((item) =>
          item !== null && typeof item === "object" && !Array.isArray(item) ? item : { value: item },
        );
      }
      if (value !== null && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({ key, value: entryValue }));
      }
      return [{ value }];
    }
    default: {
      const exhaustiveCheck: never = outputType;
      throw new Error(`Unsupported output type: ${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * Executor for `dataTransform` nodes ("Traitement" in the editor).
 *
 * Interpolates `node.input`, parses it per `node.inputType` (`parseInput`), runs `node.operations`
 * in array order, then coerces the final value to `node.outputType` (`coerceToOutputType`) so the
 * declared output type is always honored regardless of what the pipeline's last step produced.
 *
 * Uses `fast-xml-parser`/`jsonpath-plus` (already used by `@datarover/extractor` — same parsing
 * behavior for XML/JSONPath) and `yaml`, plus Node builtins only. Nothing here touches
 * `@datarover/expression-engine`'s evaluator or `eval`/`new Function`.
 */
export const dataTransformExecutor: NodeExecutor<DataTransformNode> = async (
  node: DataTransformNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  const interpolated = interpolate(node.input, ctx.expressionContext());
  let value: unknown = parseInput(interpolated, node.inputType);

  for (const operation of node.operations) {
    value = applyOperation(value, operation);
  }

  return { output: coerceToOutputType(value, node.outputType) };
};
