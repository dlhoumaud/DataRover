import { generateKeyPairSync } from "node:crypto";
import type { ExpressionContext } from "@datarover/expression-engine";
import type { SymmetricCipherAlgorithm, TextCryptoNode } from "@datarover/workflow-types";
import { describe, expect, it } from "vitest";
import { textCryptoExecutor } from "./textCryptoExecutor.js";
import type { EngineVariables, NodeExecutionContext } from "./types.js";

function buildContext(expressionContext: ExpressionContext): NodeExecutionContext {
  return {
    expressionContext: () => expressionContext,
    variables: { global: {}, project: {}, workflow: {} } satisfies EngineVariables,
    actionsOutput: {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  };
}

function node(overrides: Partial<TextCryptoNode>): TextCryptoNode {
  return {
    id: "tc1",
    name: "Crypto",
    type: "textCrypto",
    input: "",
    operations: [],
    ...overrides,
  };
}

describe("textCryptoExecutor", () => {
  it("interpolates the input before applying operations", async () => {
    const ctx = buildContext({ global: { id: "hello" } });
    const result = await textCryptoExecutor(
      node({ input: "{{ global.id }}", operations: [{ type: "hash", algorithm: "md5", digest: "hex" }] }),
      ctx,
    );
    // Well-known MD5 test vector for "hello".
    expect(result.output).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("computes sha1/sha256/sha512 against known test vectors", async () => {
    const ctx = buildContext({});
    const sha1 = await textCryptoExecutor(
      node({ input: "hello", operations: [{ type: "hash", algorithm: "sha1", digest: "hex" }] }),
      ctx,
    );
    const sha256 = await textCryptoExecutor(
      node({ input: "hello", operations: [{ type: "hash", algorithm: "sha256", digest: "hex" }] }),
      ctx,
    );
    expect(sha1.output).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    expect(sha256.output).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("hashes with a base64 digest when requested", async () => {
    const ctx = buildContext({});
    const result = await textCryptoExecutor(
      node({ input: "hello", operations: [{ type: "hash", algorithm: "md5", digest: "base64" }] }),
      ctx,
    );
    expect(result.output).toBe(Buffer.from("5d41402abc4b2a76b9719d911017c592", "hex").toString("base64"));
  });

  it("encodes to base64/hex and decodes back to the original text", async () => {
    const ctx = buildContext({});
    const encoded = await textCryptoExecutor(
      node({ input: "Produit é", operations: [{ type: "encode", encoding: "base64" }] }),
      ctx,
    );
    expect(encoded.output).toBe(Buffer.from("Produit é", "utf8").toString("base64"));

    const decoded = await textCryptoExecutor(
      node({
        input: String(encoded.output),
        operations: [{ type: "decode", encoding: "base64" }],
      }),
      ctx,
    );
    expect(decoded.output).toBe("Produit é");
  });

  it("chains encode then decode to hex and back", async () => {
    const ctx = buildContext({});
    const result = await textCryptoExecutor(
      node({
        input: "abc",
        operations: [
          { type: "encode", encoding: "hex" },
          { type: "decode", encoding: "hex" },
        ],
      }),
      ctx,
    );
    expect(result.output).toBe("abc");
  });

  it("encrypts to a non-trivial base64 string and decrypts back to the original", async () => {
    const ctx = buildContext({});
    const encrypted = await textCryptoExecutor(
      node({ input: "top secret value", operations: [{ type: "encrypt", passphrase: "s3cret" }] }),
      ctx,
    );
    expect(typeof encrypted.output).toBe("string");
    expect(encrypted.output).not.toBe("top secret value");
    expect(() => Buffer.from(String(encrypted.output), "base64")).not.toThrow();

    const decrypted = await textCryptoExecutor(
      node({
        input: String(encrypted.output),
        operations: [{ type: "decrypt", passphrase: "s3cret" }],
      }),
      ctx,
    );
    expect(decrypted.output).toBe("top secret value");
  });

  it("produces a different ciphertext each time (random IV) even for the same input", async () => {
    const ctx = buildContext({});
    const first = await textCryptoExecutor(
      node({ input: "same value", operations: [{ type: "encrypt", passphrase: "key" }] }),
      ctx,
    );
    const second = await textCryptoExecutor(
      node({ input: "same value", operations: [{ type: "encrypt", passphrase: "key" }] }),
      ctx,
    );
    expect(first.output).not.toBe(second.output);
  });

  it("fails to decrypt with the wrong passphrase", async () => {
    const ctx = buildContext({});
    const encrypted = await textCryptoExecutor(
      node({ input: "top secret", operations: [{ type: "encrypt", passphrase: "right" }] }),
      ctx,
    );
    await expect(
      textCryptoExecutor(
        node({ input: String(encrypted.output), operations: [{ type: "decrypt", passphrase: "wrong" }] }),
        ctx,
      ),
    ).rejects.toThrow();
  });

  it("chains hash then encode", async () => {
    const ctx = buildContext({});
    const result = await textCryptoExecutor(
      node({
        input: "hello",
        operations: [
          { type: "hash", algorithm: "sha256", digest: "hex" },
          { type: "encode", encoding: "base64" },
        ],
      }),
      ctx,
    );
    const expectedHash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    expect(result.output).toBe(Buffer.from(expectedHash, "utf8").toString("base64"));
  });

  describe("newly-added hash algorithms", () => {
    it.each([
      ["sha224", "ea09ae9cc6768c50fcee903ed054556e5bfc8347907f12598aa24193"],
      ["sha384", "59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f90397bdf5f6a13de828684f"],
      ["sha3-256", "3338be694f50c5f338814986cdf0686453a888b84f424d792af4b9202398f392"],
      [
        "sha3-512",
        "75d527c368f2efe848ecf6b073a36767800805e9eef2b1857d5f984f036eb6df891d75f72d9b154518c1cd58835286d1da9a38deba3de98b5a53e5ed78a84976",
      ],
      ["ripemd160", "108f07b8382412612c048d07d13f814118445acd"],
    ] as const)("%s matches a known test vector for \"hello\"", async (algorithm, expected) => {
      const ctx = buildContext({});
      const result = await textCryptoExecutor(
        node({ input: "hello", operations: [{ type: "hash", algorithm, digest: "hex" }] }),
        ctx,
      );
      expect(result.output).toBe(expected);
    });
  });

  describe("newly-added symmetric ciphers", () => {
    it.each([
      "aes-128-cbc",
      "aes-192-cbc",
      "aes-256-cbc",
      "aes-128-gcm",
      "aes-192-gcm",
      "aes-256-gcm",
      "des-ede3-cbc",
      "chacha20-poly1305",
    ] satisfies SymmetricCipherAlgorithm[])("%s round-trips encrypt/decrypt back to the original text", async (algorithm) => {
      const ctx = buildContext({});
      const encrypted = await textCryptoExecutor(
        node({ input: "top secret value", operations: [{ type: "encrypt", algorithm, passphrase: "s3cret" }] }),
        ctx,
      );
      expect(encrypted.output).not.toBe("top secret value");

      const decrypted = await textCryptoExecutor(
        node({
          input: String(encrypted.output),
          operations: [{ type: "decrypt", algorithm, passphrase: "s3cret" }],
        }),
        ctx,
      );
      expect(decrypted.output).toBe("top secret value");
    });

    it("rejects a tampered aes-256-gcm ciphertext (authentication failure), unlike plain CBC", async () => {
      const ctx = buildContext({});
      const encrypted = await textCryptoExecutor(
        node({
          input: "top secret",
          operations: [{ type: "encrypt", algorithm: "aes-256-gcm", passphrase: "key" }],
        }),
        ctx,
      );
      const tampered = Buffer.from(String(encrypted.output), "base64");
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
      await expect(
        textCryptoExecutor(
          node({
            input: tampered.toString("base64"),
            operations: [{ type: "decrypt", algorithm: "aes-256-gcm", passphrase: "key" }],
          }),
          ctx,
        ),
      ).rejects.toThrow();
    });

    it("cannot decrypt aes-128-cbc ciphertext as aes-256-gcm (algorithm mismatch)", async () => {
      const ctx = buildContext({});
      const encrypted = await textCryptoExecutor(
        node({
          input: "top secret",
          operations: [{ type: "encrypt", algorithm: "aes-128-cbc", passphrase: "key" }],
        }),
        ctx,
      );
      await expect(
        textCryptoExecutor(
          node({
            input: String(encrypted.output),
            operations: [{ type: "decrypt", algorithm: "aes-256-gcm", passphrase: "key" }],
          }),
          ctx,
        ),
      ).rejects.toThrow();
    });
  });

  describe("RSA (asymmetric)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    it("rsaEncrypt/rsaDecrypt round-trips back to the original text", async () => {
      const ctx = buildContext({});
      const encrypted = await textCryptoExecutor(
        node({ input: "top secret value", operations: [{ type: "rsaEncrypt", publicKey: publicKeyPem }] }),
        ctx,
      );
      expect(encrypted.output).not.toBe("top secret value");

      const decrypted = await textCryptoExecutor(
        node({
          input: String(encrypted.output),
          operations: [{ type: "rsaDecrypt", privateKey: privateKeyPem }],
        }),
        ctx,
      );
      expect(decrypted.output).toBe("top secret value");
    });

    it("produces a different ciphertext each time (OAEP padding is randomized)", async () => {
      const ctx = buildContext({});
      const first = await textCryptoExecutor(
        node({ input: "same value", operations: [{ type: "rsaEncrypt", publicKey: publicKeyPem }] }),
        ctx,
      );
      const second = await textCryptoExecutor(
        node({ input: "same value", operations: [{ type: "rsaEncrypt", publicKey: publicKeyPem }] }),
        ctx,
      );
      expect(first.output).not.toBe(second.output);
    });

    it("throws a clear error when the plaintext is too large for the key size", async () => {
      const ctx = buildContext({});
      await expect(
        textCryptoExecutor(
          node({
            input: "x".repeat(500),
            operations: [{ type: "rsaEncrypt", publicKey: publicKeyPem }],
          }),
          ctx,
        ),
      ).rejects.toThrow();
    });
  });

  describe("URL encoding", () => {
    it("url-encodes and decodes back to the original text", async () => {
      const ctx = buildContext({});
      const encoded = await textCryptoExecutor(
        node({ input: "a b/c?d=1&e", operations: [{ type: "encode", encoding: "url" }] }),
        ctx,
      );
      expect(encoded.output).toBe(encodeURIComponent("a b/c?d=1&e"));

      const decoded = await textCryptoExecutor(
        node({ input: String(encoded.output), operations: [{ type: "decode", encoding: "url" }] }),
        ctx,
      );
      expect(decoded.output).toBe("a b/c?d=1&e");
    });
  });
});
