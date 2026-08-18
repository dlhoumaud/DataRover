import { describe, expect, it } from "vitest";
import {
  ActionNodeSchema,
  ConditionNodeSchema,
  ExtractNodeSchema,
  HttpNodeSchema,
  SetVariableNodeSchema,
  StopNodeSchema,
} from "./action";

describe("HttpNodeSchema", () => {
  it("parses a valid http node", () => {
    const input = {
      id: "n1",
      name: "Fetch page",
      type: "http",
      method: "GET",
      url: "https://example.com",
      headers: { "User-Agent": "DataRover" },
      queryParams: { page: "1" },
      responseType: "html",
    };
    const result = HttpNodeSchema.parse(input);
    expect(result.type).toBe("http");
    expect(result.method).toBe("GET");
    expect(result.responseType).toBe("html");
  });

  it("defaults responseType to json when omitted", () => {
    const result = HttpNodeSchema.parse({
      id: "n1",
      name: "Fetch page",
      type: "http",
      method: "POST",
      url: "https://example.com",
    });
    expect(result.responseType).toBe("json");
  });

  it("rejects an invalid http method", () => {
    const input = {
      id: "n1",
      name: "Fetch page",
      type: "http",
      method: "TRACE",
      url: "https://example.com",
    };
    expect(HttpNodeSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a missing url", () => {
    const input = {
      id: "n1",
      name: "Fetch page",
      type: "http",
      method: "GET",
    };
    expect(HttpNodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("ExtractNodeSchema", () => {
  it("parses a valid extract node", () => {
    const input = {
      id: "n2",
      name: "Extract titles",
      type: "extract",
      source: "n1",
      sourceType: "html",
      rules: [
        {
          name: "title",
          strategy: "css",
          selectors: [".title"],
          output: "text",
        },
      ],
    };
    const result = ExtractNodeSchema.parse(input);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.output).toBe("text");
  });

  it("accepts the xpath strategy at the typing level (execution not implemented in V2)", () => {
    const input = {
      id: "n2",
      name: "Extract titles",
      type: "extract",
      source: "n1",
      sourceType: "html",
      rules: [
        {
          name: "title",
          strategy: "xpath",
          selectors: ["//h1"],
        },
      ],
    };
    const result = ExtractNodeSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects an extract node with an empty rules array", () => {
    const input = {
      id: "n2",
      name: "Extract titles",
      type: "extract",
      source: "n1",
      sourceType: "html",
      rules: [],
    };
    expect(ExtractNodeSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a rule with an empty selectors array", () => {
    const input = {
      id: "n2",
      name: "Extract titles",
      type: "extract",
      source: "n1",
      sourceType: "html",
      rules: [{ name: "title", strategy: "css", selectors: [] }],
    };
    expect(ExtractNodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("ConditionNodeSchema", () => {
  it("parses a valid condition node", () => {
    const result = ConditionNodeSchema.parse({
      id: "n3",
      name: "Has next page?",
      type: "condition",
      expression: "vars.hasNext === true",
    });
    expect(result.type).toBe("condition");
  });

  it("rejects a condition node missing an expression", () => {
    const input = { id: "n3", name: "Has next page?", type: "condition" };
    expect(ConditionNodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("SetVariableNodeSchema", () => {
  it("parses a valid setVariable node", () => {
    const result = SetVariableNodeSchema.parse({
      id: "n4",
      name: "Store page count",
      type: "setVariable",
      variables: { pageCount: "10" },
    });
    expect(result.variables.pageCount).toBe("10");
  });

  it("rejects non-string variable values", () => {
    const input = {
      id: "n4",
      name: "Store page count",
      type: "setVariable",
      variables: { pageCount: 10 },
    };
    expect(SetVariableNodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("StopNodeSchema", () => {
  it("parses a valid stop node without a reason", () => {
    const result = StopNodeSchema.parse({ id: "n5", name: "Stop", type: "stop" });
    expect(result.type).toBe("stop");
    expect(result.reason).toBeUndefined();
  });

  it("parses a valid stop node with a reason", () => {
    const result = StopNodeSchema.parse({
      id: "n5",
      name: "Stop",
      type: "stop",
      reason: "quota exceeded",
    });
    expect(result.reason).toBe("quota exceeded");
  });
});

describe("ActionNodeSchema (discriminated union)", () => {
  const validByType: Record<string, unknown> = {
    http: {
      id: "n1",
      name: "Fetch",
      type: "http",
      method: "GET",
      url: "https://example.com",
    },
    extract: {
      id: "n2",
      name: "Extract",
      type: "extract",
      source: "n1",
      sourceType: "html",
      rules: [{ name: "title", strategy: "css", selectors: [".title"] }],
    },
    condition: {
      id: "n3",
      name: "Condition",
      type: "condition",
      expression: "true",
    },
    setVariable: {
      id: "n4",
      name: "SetVar",
      type: "setVariable",
      variables: { a: "1" },
    },
    stop: {
      id: "n5",
      name: "Stop",
      type: "stop",
    },
  };

  it.each(Object.entries(validByType))("parses a valid %s node", (type, input) => {
    const result = ActionNodeSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe(type);
    }
  });

  it("rejects a node with an unknown type", () => {
    const input = {
      id: "n6",
      name: "Mystery node",
      type: "teleport",
      destination: "n1",
    };
    const result = ActionNodeSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a node with a missing type", () => {
    const input = { id: "n6", name: "Mystery node" };
    const result = ActionNodeSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects a valid-shaped node whose type does not match its own schema", () => {
    // http fields but tagged as "extract"
    const input = {
      id: "n1",
      name: "Fetch",
      type: "extract",
      method: "GET",
      url: "https://example.com",
    };
    const result = ActionNodeSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("applies node-specific defaults through the union", () => {
    const result = ActionNodeSchema.parse(validByType.http);
    if (result.type === "http") {
      expect(result.responseType).toBe("json");
    } else {
      throw new Error("expected http node");
    }
  });
});
