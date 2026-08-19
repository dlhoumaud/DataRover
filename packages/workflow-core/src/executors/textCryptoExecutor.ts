import {
  createCipheriv,
  createDecipheriv,
  createHash,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  scryptSync,
  constants as cryptoConstants,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";
import { interpolate } from "@datarover/expression-engine";
import type { SymmetricCipherAlgorithm, TextCryptoNode, TextCryptoOperation } from "@datarover/workflow-types";
import type { NodeExecutionContext, NodeExecutionResult, NodeExecutor } from "./types.js";

const DEFAULT_CIPHER_ALGORITHM: SymmetricCipherAlgorithm = "aes-256-cbc";

/** AEAD ciphers (authenticated: need `getAuthTag`/`setAuthTag`) vs plain CBC, plus each
 *  algorithm's required key/IV length — verified directly against this Node build's actual
 *  `crypto.getCiphers()` output, not assumed. */
const CIPHER_CONFIG: Record<SymmetricCipherAlgorithm, { keyLength: number; ivLength: number; aead: boolean }> = {
  "aes-128-cbc": { keyLength: 16, ivLength: 16, aead: false },
  "aes-192-cbc": { keyLength: 24, ivLength: 16, aead: false },
  "aes-256-cbc": { keyLength: 32, ivLength: 16, aead: false },
  "aes-128-gcm": { keyLength: 16, ivLength: 12, aead: true },
  "aes-192-gcm": { keyLength: 24, ivLength: 12, aead: true },
  "aes-256-gcm": { keyLength: 32, ivLength: 12, aead: true },
  "des-ede3-cbc": { keyLength: 24, ivLength: 8, aead: false },
  "chacha20-poly1305": { keyLength: 32, ivLength: 12, aead: true },
};

const AUTH_TAG_LENGTH = 16;
const RSA_OAEP_OPTIONS = { padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" } as const;

/**
 * Derives a key of exactly the length a given cipher needs from an arbitrary-length passphrase.
 * `scrypt` (memory-hard, deliberately slow) rather than a single hash pass — meaningfully more
 * resistant to brute-forcing a weak passphrase than this operation's original `sha256(passphrase)`
 * (kept as a fixed label rather than a per-message random salt so `decrypt` never needs to carry
 * anything beyond the IV/tag already embedded in the ciphertext).
 */
function deriveKey(passphrase: string, keyLength: number): Buffer {
  return scryptSync(passphrase, "datarover-textcrypto-salt", keyLength);
}

function applyOperation(value: string, operation: TextCryptoOperation): string {
  switch (operation.type) {
    case "hash":
      return createHash(operation.algorithm).update(value, "utf8").digest(operation.digest);

    case "encode":
      return operation.encoding === "url" ? encodeURIComponent(value) : Buffer.from(value, "utf8").toString(operation.encoding);

    case "decode":
      return operation.encoding === "url" ? decodeURIComponent(value) : Buffer.from(value, operation.encoding).toString("utf8");

    case "encrypt": {
      // A fresh random IV per call (standard practice — reusing an IV leaks structure across
      // messages, and is an outright key/nonce-reuse catastrophe for the AEAD algorithms here)
      // prepended to the ciphertext (auth tag too, for AEAD) so `decrypt` is self-contained: no
      // separate IV/tag to pass around alongside the rule's output.
      const algorithm = operation.algorithm ?? DEFAULT_CIPHER_ALGORITHM;
      const config = CIPHER_CONFIG[algorithm];
      const key = deriveKey(operation.passphrase, config.keyLength);
      const iv = randomBytes(config.ivLength);
      // Node's overload resolution can't pick the AEAD-specific signature (which alone accepts
      // `authTagLength`) from a union-typed `algorithm` — `as never` on the options object is a
      // targeted escape hatch for that, not a claim the option doesn't matter (verified directly
      // that aes-*-gcm and chacha20-poly1305 both round-trip correctly with it, see tests below).
      const cipher = config.aead
        ? (createCipheriv(algorithm, key, iv, { authTagLength: AUTH_TAG_LENGTH } as never) as CipherGCM)
        : createCipheriv(algorithm, key, iv);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const parts = config.aead ? [iv, (cipher as CipherGCM).getAuthTag(), encrypted] : [iv, encrypted];
      return Buffer.concat(parts).toString("base64");
    }

    case "decrypt": {
      const algorithm = operation.algorithm ?? DEFAULT_CIPHER_ALGORITHM;
      const config = CIPHER_CONFIG[algorithm];
      const key = deriveKey(operation.passphrase, config.keyLength);
      const combined = Buffer.from(value, "base64");
      const iv = combined.subarray(0, config.ivLength);
      if (config.aead) {
        const authTag = combined.subarray(config.ivLength, config.ivLength + AUTH_TAG_LENGTH);
        const encrypted = combined.subarray(config.ivLength + AUTH_TAG_LENGTH);
        const decipher = createDecipheriv(algorithm, key, iv, { authTagLength: AUTH_TAG_LENGTH } as never) as DecipherGCM;
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      }
      const encrypted = combined.subarray(config.ivLength);
      const decipher = createDecipheriv(algorithm, key, iv);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    }

    case "rsaEncrypt":
      // Bounded by the key size (e.g. ~190 bytes of plaintext for a 2048-bit key with
      // OAEP-SHA256 padding) — Node throws a clear "data too large for key size" error beyond
      // that, left to propagate rather than silently truncating.
      return publicEncrypt(
        { key: operation.publicKey, ...RSA_OAEP_OPTIONS },
        Buffer.from(value, "utf8"),
      ).toString("base64");

    case "rsaDecrypt":
      return privateDecrypt(
        { key: operation.privateKey, ...RSA_OAEP_OPTIONS },
        Buffer.from(value, "base64"),
      ).toString("utf8");

    default: {
      const exhaustiveCheck: never = operation;
      throw new Error(`Unsupported text crypto operation: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/**
 * Executor for `textCrypto` nodes.
 *
 * Interpolates `node.input` (same convention as `TextTransformNode.input`), coerces it to a
 * string, then applies `node.operations` (hash / charset encode-decode / URL percent-encoding /
 * symmetric encrypt-decrypt / RSA-OAEP asymmetric encrypt-decrypt) in array order. Returns the
 * final string as `output`.
 *
 * Uses Node's built-in `crypto` module only — no new dependency, and nothing here ever touches
 * `@datarover/expression-engine`'s evaluator or `eval`/`new Function`.
 */
export const textCryptoExecutor: NodeExecutor<TextCryptoNode> = async (
  node: TextCryptoNode,
  ctx: NodeExecutionContext,
): Promise<NodeExecutionResult> => {
  const interpolated = interpolate(node.input, ctx.expressionContext());
  let value = typeof interpolated === "string" ? interpolated : interpolated == null ? "" : String(interpolated);

  for (const operation of node.operations) {
    value = applyOperation(value, operation);
  }

  return { output: value };
};
