import { describe, expect, it } from "vitest";
import {
  ActionNodeSchema,
  ConditionNodeSchema,
  ExtractNodeSchema,
  HttpNodeSchema,
  LoopNodeSchema,
  SetVariableNodeSchema,
  StopNodeSchema,
  TextCryptoNodeSchema,
  DataTransformNodeSchema,
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

describe("DataTransformNodeSchema", () => {
  it("parses a valid node with a mixed operations pipeline, defaulting inputType/outputType", () => {
    const result = DataTransformNodeSchema.parse({
      id: "n6",
      name: "Normalize title",
      type: "dataTransform",
      input: "{{ actions.extract1.output.title }}",
      operations: [
        { type: "trim" },
        { type: "lower" },
        { type: "replace", search: " ", replacement: "-", all: true },
      ],
    });
    expect(result.operations).toHaveLength(3);
    expect(result.operations[1]).toEqual({ type: "lower" });
    expect(result.inputType).toBe("raw");
    expect(result.outputType).toBe("text");
  });

  it("accepts an explicit inputType/outputType and structured operations", () => {
    const result = DataTransformNodeSchema.parse({
      id: "n6",
      name: "Extract price",
      type: "dataTransform",
      input: "{{ actions.http1.output }}",
      inputType: "json",
      operations: [{ type: "getPath", path: "$.items[0].price" }],
      outputType: "float",
    });
    expect(result.inputType).toBe("json");
    expect(result.outputType).toBe("float");
    expect(result.operations[0]).toEqual({ type: "getPath", path: "$.items[0].price" });
  });

  it("defaults replace.all to false and padStart.char to a space", () => {
    const result = DataTransformNodeSchema.parse({
      id: "n6",
      name: "Pad",
      type: "dataTransform",
      input: "{{ 1 }}",
      operations: [
        { type: "replace", search: "a", replacement: "b" },
        { type: "padStart", length: 4 },
      ],
    });
    expect(result.operations[0]).toMatchObject({ all: false });
    expect(result.operations[1]).toMatchObject({ char: " " });
  });

  it("rejects an empty operations array", () => {
    const input = { id: "n6", name: "No-op", type: "dataTransform", input: "x", operations: [] };
    expect(DataTransformNodeSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown operation type", () => {
    const input = {
      id: "n6",
      name: "Bad op",
      type: "dataTransform",
      input: "x",
      operations: [{ type: "titleCase" }],
    };
    expect(DataTransformNodeSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unknown inputType/outputType", () => {
    const badInput = {
      id: "n6",
      name: "Bad",
      type: "dataTransform",
      input: "x",
      inputType: "csv",
      operations: [{ type: "lower" }],
    };
    expect(DataTransformNodeSchema.safeParse(badInput).success).toBe(false);

    const badOutput = {
      id: "n6",
      name: "Bad",
      type: "dataTransform",
      input: "x",
      operations: [{ type: "lower" }],
      outputType: "array",
    };
    expect(DataTransformNodeSchema.safeParse(badOutput).success).toBe(false);
  });
});

describe("TextCryptoNodeSchema", () => {
  it("parses a valid hash pipeline", () => {
    const result = TextCryptoNodeSchema.parse({
      id: "n7",
      name: "Hash id",
      type: "textCrypto",
      input: "{{ actions.extract1.output.id }}",
      operations: [{ type: "hash", algorithm: "sha256" }],
    });
    expect(result.operations[0]).toMatchObject({ algorithm: "sha256", digest: "hex" });
  });

  it("parses an encrypt/decrypt pipeline", () => {
    const result = TextCryptoNodeSchema.parse({
      id: "n7",
      name: "Round-trip",
      type: "textCrypto",
      input: "secret",
      operations: [
        { type: "encrypt", passphrase: "s3cret" },
        { type: "decrypt", passphrase: "s3cret" },
      ],
    });
    expect(result.operations).toHaveLength(2);
  });

  it("parses an encrypt/decrypt pipeline with an explicit algorithm", () => {
    const result = TextCryptoNodeSchema.parse({
      id: "n7",
      name: "AES-GCM round-trip",
      type: "textCrypto",
      input: "secret",
      operations: [
        { type: "encrypt", algorithm: "aes-256-gcm", passphrase: "s3cret" },
        { type: "decrypt", algorithm: "aes-256-gcm", passphrase: "s3cret" },
      ],
    });
    expect(result.operations[0]).toMatchObject({ algorithm: "aes-256-gcm" });
  });

  it("leaves algorithm undefined (not defaulted) when omitted, for backward compatibility", () => {
    const result = TextCryptoNodeSchema.parse({
      id: "n7",
      name: "No algorithm specified",
      type: "textCrypto",
      input: "secret",
      operations: [{ type: "encrypt", passphrase: "s3cret" }],
    });
    expect(result.operations[0]).not.toHaveProperty("algorithm");
  });

  it("parses an rsaEncrypt/rsaDecrypt pipeline", () => {
    const result = TextCryptoNodeSchema.parse({
      id: "n7",
      name: "RSA",
      type: "textCrypto",
      input: "secret",
      operations: [
        { type: "rsaEncrypt", publicKey: "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" },
      ],
    });
    expect(result.operations[0]).toMatchObject({ type: "rsaEncrypt" });
  });

  it("rejects an rsaEncrypt operation with an empty public key", () => {
    const input = {
      id: "n7",
      name: "Bad",
      type: "textCrypto",
      input: "x",
      operations: [{ type: "rsaEncrypt", publicKey: "" }],
    };
    expect(TextCryptoNodeSchema.safeParse(input).success).toBe(false);
  });

  it("parses a url encode/decode pipeline", () => {
    const result = TextCryptoNodeSchema.parse({
      id: "n7",
      name: "URL round-trip",
      type: "textCrypto",
      input: "a b/c",
      operations: [
        { type: "encode", encoding: "url" },
        { type: "decode", encoding: "url" },
      ],
    });
    expect(result.operations).toHaveLength(2);
  });

  it("accepts every newly-added hash algorithm", () => {
    for (const algorithm of ["sha224", "sha384", "sha3-256", "sha3-512", "ripemd160", "blake2b512"]) {
      const result = TextCryptoNodeSchema.safeParse({
        id: "n7",
        name: "Hash",
        type: "textCrypto",
        input: "x",
        operations: [{ type: "hash", algorithm }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts every newly-added symmetric cipher algorithm", () => {
    for (const algorithm of ["aes-128-cbc", "aes-192-gcm", "des-ede3-cbc", "chacha20-poly1305"]) {
      const result = TextCryptoNodeSchema.safeParse({
        id: "n7",
        name: "Cipher",
        type: "textCrypto",
        input: "x",
        operations: [{ type: "encrypt", algorithm, passphrase: "k" }],
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an encrypt operation with an empty passphrase", () => {
    const input = {
      id: "n7",
      name: "Bad",
      type: "textCrypto",
      input: "x",
      operations: [{ type: "encrypt", passphrase: "" }],
    };
    expect(TextCryptoNodeSchema.safeParse(input).success).toBe(false);
  });

  it("rejects an unsupported hash algorithm", () => {
    const input = {
      id: "n7",
      name: "Bad",
      type: "textCrypto",
      input: "x",
      operations: [{ type: "hash", algorithm: "sha3" }],
    };
    expect(TextCryptoNodeSchema.safeParse(input).success).toBe(false);
  });
});

describe("LoopNodeSchema", () => {
  it("parses a valid loop node, defaulting outputMode to list", () => {
    const result = LoopNodeSchema.parse({
      id: "n8",
      name: "For each product",
      type: "loop",
      source: "{{ actions.extract1.output.items }}",
      body: [{ id: "n8Step1", name: "Capture", type: "setVariable", variables: { seen: "{{ item }}" } }],
    });
    expect(result.outputMode).toBe("list");
    expect(result.body).toHaveLength(1);
  });

  it("accepts an explicit outputMode and a multi-step body", () => {
    const result = LoopNodeSchema.parse({
      id: "n8",
      name: "For each product",
      type: "loop",
      source: "{{ global.items }}",
      outputMode: "last",
      body: [
        { id: "n8Step1", name: "Fetch detail", type: "http", method: "GET", url: "{{ item }}" },
        {
          id: "n8Step2",
          name: "Extract price",
          type: "extract",
          source: "n8Step1",
          sourceType: "json",
          rules: [{ name: "price", strategy: "jsonpath", selectors: ["$.price"] }],
        },
      ],
    });
    expect(result.outputMode).toBe("last");
    expect(result.body).toHaveLength(2);
  });

  it("rejects an empty body", () => {
    const input = { id: "n8", name: "Empty", type: "loop", source: "{{ global.items }}", body: [] };
    expect(LoopNodeSchema.safeParse(input).success).toBe(false);
  });

  it.each(["condition", "stop", "loop"])("rejects a body step of type %s", (type) => {
    const bodyStep =
      type === "condition"
        ? { id: "s1", name: "Cond", type: "condition", expression: "true" }
        : type === "stop"
          ? { id: "s1", name: "Stop", type: "stop" }
          : { id: "s1", name: "Nested loop", type: "loop", source: "{{ item }}", body: [] };
    const input = { id: "n8", name: "Bad body", type: "loop", source: "{{ global.items }}", body: [bodyStep] };
    expect(LoopNodeSchema.safeParse(input).success).toBe(false);
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
    dataTransform: {
      id: "n6",
      name: "Normalize",
      type: "dataTransform",
      input: "x",
      operations: [{ type: "lower" }],
    },
    textCrypto: {
      id: "n7",
      name: "Hash",
      type: "textCrypto",
      input: "x",
      operations: [{ type: "hash", algorithm: "md5" }],
    },
    loop: {
      id: "n8",
      name: "Loop",
      type: "loop",
      source: "{{ global.items }}",
      body: [{ id: "n8Step1", name: "Capture", type: "setVariable", variables: {} }],
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
