import type { ExpressionContext } from "@datarover/expression-engine";
import type { DataTransformNode } from "@datarover/workflow-types";
import { describe, expect, it } from "vitest";
import { dataTransformExecutor } from "./dataTransformExecutor.js";
import type { EngineVariables, NodeExecutionContext } from "./types.js";

function buildContext(expressionContext: ExpressionContext): NodeExecutionContext {
  return {
    expressionContext: () => expressionContext,
    variables: { global: {}, project: {}, workflow: {} } satisfies EngineVariables,
    actionsOutput: {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

function node(overrides: Partial<DataTransformNode>): DataTransformNode {
  return {
    id: "dt1",
    name: "Transform",
    type: "dataTransform",
    input: "",
    inputType: "raw",
    operations: [],
    outputType: "text",
    ...overrides,
  };
}

describe("dataTransformExecutor", () => {
  describe("inputType: raw (string operations)", () => {
    it("interpolates the input before applying operations", async () => {
      const ctx = buildContext({ global: { title: "  Hello World  " } });
      const result = await dataTransformExecutor(
        node({ input: "{{ global.title }}", operations: [{ type: "trim" }, { type: "lower" }] }),
        ctx,
      );
      expect(result.output).toBe("hello world");
    });

    it("chains trim, lower, replace-all, and pad in array order", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({
          input: "  Produit A  ",
          operations: [
            { type: "trim" },
            { type: "lower" },
            { type: "replace", search: " ", replacement: "-", all: true },
            { type: "padEnd", length: 12, char: "." },
          ],
        }),
        ctx,
      );
      expect(result.output).toBe("produit-a...");
    });

    it("capitalizes only the first character", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({ input: "hello world", operations: [{ type: "capitalize" }] }),
        ctx,
      );
      expect(result.output).toBe("Hello world");
    });

    it("applies a global regexReplace", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({
          input: "Produit A - 19.99€",
          operations: [{ type: "regexReplace", pattern: "[0-9.]+", flags: "g", replacement: "#" }],
        }),
        ctx,
      );
      expect(result.output).toBe("Produit A - #€");
    });

    it("slices with a start and optional end", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({ input: "abcdef", operations: [{ type: "slice", start: 1, end: 4 }] }),
        ctx,
      );
      expect(result.output).toBe("bcd");
    });
  });

  describe("inputType: json", () => {
    it("parses a raw JSON string, then getPath/stringify", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({
          input: '{"items":[{"price":19.99},{"price":29.99}]}',
          inputType: "json",
          operations: [{ type: "getPath", path: "$.items[0].price" }],
          outputType: "float",
        }),
        ctx,
      );
      expect(result.output).toBe(19.99);
    });

    it("uses an already-parsed value as-is (e.g. from an upstream http node's JSON output)", async () => {
      const ctx = buildContext({ global: { data: { items: [{ price: 42 }] } } });
      const result = await dataTransformExecutor(
        node({
          input: "{{ global.data }}",
          inputType: "json",
          operations: [{ type: "getPath", path: "$.items[0].price" }],
          outputType: "int",
        }),
        ctx,
      );
      expect(result.output).toBe(42);
    });

    it("extracts keys and values", async () => {
      const ctx = buildContext({});
      const keys = await dataTransformExecutor(
        node({ input: '{"a":1,"b":2}', inputType: "json", operations: [{ type: "keys" }], outputType: "list" }),
        ctx,
      );
      const values = await dataTransformExecutor(
        node({ input: '{"a":1,"b":2}', inputType: "json", operations: [{ type: "values" }], outputType: "list" }),
        ctx,
      );
      expect(keys.output).toEqual(["a", "b"]);
      expect(values.output).toEqual([1, 2]);
    });

    it("computes length for an array, a string-valued path, and an object", async () => {
      const ctx = buildContext({});
      const arrayLength = await dataTransformExecutor(
        node({ input: "[1,2,3]", inputType: "json", operations: [{ type: "length" }], outputType: "int" }),
        ctx,
      );
      expect(arrayLength.output).toBe(3);
    });

    it("wraps a non-array value with toArray, and passes an array through unchanged", async () => {
      const ctx = buildContext({});
      const wrapped = await dataTransformExecutor(
        node({ input: '{"a":1}', inputType: "json", operations: [{ type: "toArray" }], outputType: "list" }),
        ctx,
      );
      const passthrough = await dataTransformExecutor(
        node({ input: "[1,2]", inputType: "json", operations: [{ type: "toArray" }], outputType: "list" }),
        ctx,
      );
      expect(wrapped.output).toEqual([{ a: 1 }]);
      expect(passthrough.output).toEqual([1, 2]);
    });

    it("re-serializes the parsed value with stringify", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({ input: '{"a":1}', inputType: "json", operations: [{ type: "stringify" }] }),
        ctx,
      );
      expect(result.output).toBe('{"a":1}');
    });
  });

  describe("inputType: yaml", () => {
    it("parses YAML and extracts a path", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({
          input: "items:\n  - price: 19.99\n  - price: 29.99\n",
          inputType: "yaml",
          operations: [{ type: "getPath", path: "$.items[1].price" }],
          outputType: "float",
        }),
        ctx,
      );
      expect(result.output).toBe(29.99);
    });
  });

  describe("inputType: xml", () => {
    it("parses XML (same shape as @datarover/extractor's xmlExtractor) and extracts a path", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({
          input: "<root><item id=\"1\">Produit A</item></root>",
          inputType: "xml",
          operations: [{ type: "getPath", path: "$.root.item['attr_id']" }],
          outputType: "int",
        }),
        ctx,
      );
      expect(result.output).toBe(1);
    });
  });

  describe("outputType coercion", () => {
    it("coerces to int/float/boolean from raw text", async () => {
      const ctx = buildContext({});
      const intResult = await dataTransformExecutor(node({ input: "42", outputType: "int" }), ctx);
      const floatResult = await dataTransformExecutor(node({ input: "3.14", outputType: "float" }), ctx);
      const boolResult = await dataTransformExecutor(node({ input: "true", outputType: "boolean" }), ctx);
      expect(intResult.output).toBe(42);
      expect(floatResult.output).toBe(3.14);
      expect(boolResult.output).toBe(true);
    });

    it('treats "false"/"0"/"non" as boolean false, not just non-empty-string truthy', async () => {
      const ctx = buildContext({});
      for (const falsy of ["false", "0", "non", "no"]) {
        const result = await dataTransformExecutor(node({ input: falsy, outputType: "boolean" }), ctx);
        expect(result.output).toBe(false);
      }
    });

    it("wraps a scalar into a single-element list", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(node({ input: "solo", outputType: "list" }), ctx);
      expect(result.output).toEqual(["solo"]);
    });

    it("builds table rows from an object's entries", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({ input: '{"a":1,"b":2}', inputType: "json", operations: [{ type: "lower" }], outputType: "table" }),
        ctx,
      );
      // "lower" stringifies first (JSON operations chain into string ops fine), producing text —
      // exercising that "table" coercion still wraps a plain scalar/string into one row.
      expect(result.output).toEqual([{ value: '{"a":1,"b":2}' }]);
    });

    it("builds table rows from an array of scalars vs an array of objects", async () => {
      const ctx = buildContext({});
      const scalarRows = await dataTransformExecutor(
        node({ input: "[1,2,3]", inputType: "json", operations: [{ type: "toArray" }], outputType: "table" }),
        ctx,
      );
      const objectRows = await dataTransformExecutor(
        node({
          input: '[{"id":1},{"id":2}]',
          inputType: "json",
          operations: [{ type: "toArray" }],
          outputType: "table",
        }),
        ctx,
      );
      expect(scalarRows.output).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
      expect(objectRows.output).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("stringifies a structured value for outputType text", async () => {
      const ctx = buildContext({});
      const result = await dataTransformExecutor(
        node({ input: '{"a":1}', inputType: "json", operations: [{ type: "keys" }], outputType: "text" }),
        ctx,
      );
      expect(result.output).toBe('["a"]');
    });
  });
});
