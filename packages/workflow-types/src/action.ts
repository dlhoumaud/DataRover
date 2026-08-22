import { z } from "zod";

/**
 * Retry behaviour applied by the execution engine when a node fails.
 */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).default(1),
  backoffMs: z.number().int().min(0).default(0),
  backoffMultiplier: z.number().min(1).default(1),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

/**
 * A node's position on the editor canvas. Optional (never `.default()`) so that a workflow saved
 * before this field existed still parses unchanged — `apps/web`'s `definitionToFlow` falls back to
 * its own computed `autoLayout` position for any node where this is absent, exactly as if the field
 * had never been added. Persisted verbatim otherwise: unlike everything else on `BaseNodeSchema`,
 * this carries no execution meaning at all, purely an editor affordance.
 */
export const NodePositionSchema = z.object({ x: z.number(), y: z.number() });
export type NodePosition = z.infer<typeof NodePositionSchema>;

/**
 * Fields shared by every node type in a workflow graph.
 * Not exported: consumers should rely on the discriminated `ActionNodeSchema`
 * union (and its inferred `ActionNode` type) rather than this base shape.
 */
const BaseNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  retryPolicy: RetryPolicySchema.optional(),
  position: NodePositionSchema.optional(),
});

/**
 * How a node reaches the network: `"direct"` (the executing process's own address — existing
 * behavior, and always the default) or `"proxy"` (reserve one available proxy from the global
 * pool for the duration of this node's execution — see `httpExecutor.ts`/`browserActionExecutor.ts`
 * and `NodeExecutionContext.proxyPool`). Shared between `http` and `browserAction` rather than
 * declared twice since the semantics are identical either way.
 */
export const NetworkModeSchema = z.enum(["direct", "proxy"]).default("direct");
export type NetworkMode = z.infer<typeof NetworkModeSchema>;

/**
 * Performs an HTTP request.
 */
export const HttpNodeSchema = BaseNodeSchema.extend({
  type: z.literal("http"),
  method: HttpMethod,
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  responseType: z.enum(["html", "json", "xml", "text", "file"]).default("json"),
  networkMode: NetworkModeSchema,
});
export type HttpNode = z.infer<typeof HttpNodeSchema>;

export const ExtractSourceType = z.enum(["html", "json", "xml"]);
export type ExtractSourceType = z.infer<typeof ExtractSourceType>;

/**
 * Strategy used to locate data within a source document.
 *
 * NOTE: "xpath" is a valid type at the schema/typing level in this
 * iteration, but its execution is NOT implemented yet (planned for V2).
 * It is accepted here purely as a typing constraint.
 */
export const ExtractStrategyType = z.enum(["css", "xpath", "jsonpath", "regex"]);
export type ExtractStrategyType = z.infer<typeof ExtractStrategyType>;

export const ExtractOutputType = z.enum(["text", "attribute", "list", "table", "value"]);
export type ExtractOutputType = z.infer<typeof ExtractOutputType>;

export const ExtractionRuleSchema = z.object({
  name: z.string(),
  strategy: ExtractStrategyType,
  selectors: z.array(z.string()).min(1),
  attribute: z.string().optional(),
  output: ExtractOutputType.default("text"),
});
export type ExtractionRule = z.infer<typeof ExtractionRuleSchema>;

/**
 * Extracts structured data from a previously fetched source using one or
 * more extraction rules.
 */
export const ExtractNodeSchema = BaseNodeSchema.extend({
  type: z.literal("extract"),
  source: z.string(),
  sourceType: ExtractSourceType,
  rules: z.array(ExtractionRuleSchema).min(1),
});
export type ExtractNode = z.infer<typeof ExtractNodeSchema>;

/**
 * Branches the workflow graph based on a boolean expression evaluated at
 * runtime. Downstream edges select their branch via `Edge.branch`.
 */
export const ConditionNodeSchema = BaseNodeSchema.extend({
  type: z.literal("condition"),
  expression: z.string(),
});
export type ConditionNode = z.infer<typeof ConditionNodeSchema>;

/**
 * Assigns one or more variables in the current execution context.
 */
export const SetVariableNodeSchema = BaseNodeSchema.extend({
  type: z.literal("setVariable"),
  variables: z.record(z.string(), z.string()),
});
export type SetVariableNode = z.infer<typeof SetVariableNodeSchema>;

/**
 * Terminates the workflow execution, optionally recording a reason.
 */
export const StopNodeSchema = BaseNodeSchema.extend({
  type: z.literal("stop"),
  reason: z.string().optional(),
});
export type StopNode = z.infer<typeof StopNodeSchema>;

/**
 * The shape `dataTransform` parses `input` into before running `operations`. `"raw"` keeps it as
 * plain text; `"json"`/`"yaml"`/`"xml"` parse it into a plain JS value — unless it already is one
 * (e.g. an upstream `http` node with `responseType: "json"` already hands downstream nodes a
 * parsed object/array via interpolation, never a re-encoded string — see httpExecutor.ts), in
 * which case it's used as-is.
 */
export const DataInputType = z.enum(["raw", "json", "yaml", "xml"]);
export type DataInputType = z.infer<typeof DataInputType>;

/**
 * The shape `dataTransform` coerces its final value to after running `operations`, regardless of
 * what the last operation happened to produce — this is what makes `outputType` meaningful even
 * for operations whose natural result type isn't statically knowable (`getPath` into an unknown
 * document, say): the coercion step (see `dataTransformExecutor.ts`) normalizes whatever came out
 * to exactly this shape. `"table"` produces an array of plain row objects (wrapping scalars/each
 * array item, or an object's entries, as needed) — distinct from `"list"`, which just guarantees
 * an array without reshaping its contents.
 */
export const DataOutputType = z.enum(["text", "list", "table", "int", "float", "boolean"]);
export type DataOutputType = z.infer<typeof DataOutputType>;

/**
 * A single step of a `dataTransform` pipeline, applied in array order. The string-editing
 * operations (`lower` … `padEnd`) are meant for `inputType: "raw"`; the structured-value
 * operations (`getPath` … `stringify`) for `"json"`/`"yaml"`/`"xml"` (the editor only offers the
 * matching subset per `inputType` — see TextTransformNodeInspector's replacement,
 * DataTransformNodeInspector); `toInt`/`toFloat`/`toBoolean` make sense either way and are offered
 * regardless. Every operation is pure/synchronous — no I/O, hence no `timeoutMs`/`retryPolicy` on
 * the node itself.
 */
export const DataTransformOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("lower") }),
  z.object({ type: z.literal("upper") }),
  /** Uppercases the first character only — "capitalize", not title-case. */
  z.object({ type: z.literal("capitalize") }),
  z.object({
    type: z.literal("replace"),
    search: z.string(),
    replacement: z.string(),
    /** Replace every occurrence rather than just the first. Defaults to the first only. */
    all: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("regexReplace"),
    pattern: z.string(),
    /** Standard `RegExp` flags (e.g. "gi") — include "g" to replace every match. */
    flags: z.string().default(""),
    replacement: z.string(),
  }),
  z.object({ type: z.literal("slice"), start: z.number().int(), end: z.number().int().optional() }),
  z.object({ type: z.literal("trim") }),
  /** "ltrim". */
  z.object({ type: z.literal("trimStart") }),
  /** "rtrim". */
  z.object({ type: z.literal("trimEnd") }),
  /** "padleft". */
  z.object({ type: z.literal("padStart"), length: z.number().int().min(0), char: z.string().default(" ") }),
  /** "padright". */
  z.object({ type: z.literal("padEnd"), length: z.number().int().min(0), char: z.string().default(" ") }),
  /** JSONPath (same convention/library as ExtractNode's "jsonpath" strategy) — takes the first match. */
  z.object({ type: z.literal("getPath"), path: z.string().min(1) }),
  /** Object keys, as a list — `[]` for a non-object. */
  z.object({ type: z.literal("keys") }),
  /** Object values, as a list — `[]` for a non-object. */
  z.object({ type: z.literal("values") }),
  /** Wraps a non-array value in a single-element array; passes an array through unchanged. */
  z.object({ type: z.literal("toArray") }),
  /** Array/string length, or an object's key count. */
  z.object({ type: z.literal("length") }),
  /** Serializes the current value back to a JSON string. */
  z.object({ type: z.literal("stringify") }),
  z.object({ type: z.literal("toInt") }),
  z.object({ type: z.literal("toFloat") }),
  z.object({ type: z.literal("toBoolean") }),
]);
export type DataTransformOperation = z.infer<typeof DataTransformOperationSchema>;

/**
 * "Traitement" in the editor. Parses `input` (interpolated first — a `{{ }}` expression
 * referencing an earlier node's output, exactly like `ExtractNode.source`) according to
 * `inputType`, runs `operations` in order, then coerces the result to `outputType`.
 */
export const DataTransformNodeSchema = BaseNodeSchema.extend({
  type: z.literal("dataTransform"),
  input: z.string(),
  inputType: DataInputType.default("raw"),
  operations: z.array(DataTransformOperationSchema).min(1),
  outputType: DataOutputType.default("text"),
});
export type DataTransformNode = z.infer<typeof DataTransformNodeSchema>;

/** Every algorithm here is confirmed available via Node's built-in `crypto.getHashes()` on a
 *  standard Node/OpenSSL 3 build (verified directly, not assumed) — no exotic/legacy digest that
 *  might be disabled on a given platform. */
export const HashAlgorithm = z.enum([
  "md5",
  "sha1",
  "sha224",
  "sha256",
  "sha384",
  "sha512",
  "sha3-224",
  "sha3-256",
  "sha3-384",
  "sha3-512",
  "ripemd160",
  "blake2b512",
  "blake2s256",
]);
export type HashAlgorithm = z.infer<typeof HashAlgorithm>;

/** Charsets/binary-to-text encodings supported by Node's `Buffer` (utf8/utf16le/latin1/ascii for
 *  charset reinterpretation, base64/hex for binary-to-text), plus "url" (percent-encoding via
 *  `encodeURIComponent`/`decodeURIComponent` — not a `Buffer` encoding, handled separately in the
 *  executor). */
export const TextEncoding = z.enum(["utf8", "utf16le", "latin1", "ascii", "base64", "base64url", "hex", "url"]);
export type TextEncoding = z.infer<typeof TextEncoding>;

/**
 * Symmetric ciphers offered for `encrypt`/`decrypt`, all confirmed available in this Node build
 * (`crypto.getCiphers()`) — single DES, RC4, and Blowfish are deliberately NOT offered: modern
 * OpenSSL 3 disables them by default (they didn't even show up as available), and they're broken
 * ciphers besides.
 */
export const SymmetricCipherAlgorithm = z.enum([
  "aes-128-cbc",
  "aes-192-cbc",
  "aes-256-cbc",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "des-ede3-cbc",
  "chacha20-poly1305",
]);
export type SymmetricCipherAlgorithm = z.infer<typeof SymmetricCipherAlgorithm>;

/**
 * A single step of a `textCrypto` pipeline, applied in array order over one string.
 */
export const TextCryptoOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hash"), algorithm: HashAlgorithm, digest: z.enum(["hex", "base64"]).default("hex") }),
  /** Re-encodes the current text (assumed UTF-8) as bytes in `encoding`. */
  z.object({ type: z.literal("encode"), encoding: TextEncoding }),
  /** Reverses `encode`: interprets the current text as `encoding`-encoded bytes and decodes back to UTF-8. */
  z.object({ type: z.literal("decode"), encoding: TextEncoding }),
  /**
   * Keyed by a passphrase (scrypt-derived to the algorithm's required key length — see
   * `textCryptoExecutor.ts`); output is base64(iv [+ authTag for AEAD algorithms] + ciphertext),
   * self-contained for `decrypt` to reverse. `algorithm` is optional (not `.default()`, so old
   * saved workflows/tests from before this field existed keep parsing/typechecking as-is) —
   * `aes-256-cbc` when omitted, matching this operation's original, only-ever behavior.
   */
  z.object({ type: z.literal("encrypt"), algorithm: SymmetricCipherAlgorithm.optional(), passphrase: z.string().min(1) }),
  z.object({ type: z.literal("decrypt"), algorithm: SymmetricCipherAlgorithm.optional(), passphrase: z.string().min(1) }),
  /** RSA-OAEP(SHA-256), asymmetric — a PEM public key, not a passphrase. Payload size is bounded
   *  by the key size (e.g. ~190 bytes for a 2048-bit key); a longer input throws a clear Node error. */
  z.object({ type: z.literal("rsaEncrypt"), publicKey: z.string().min(1) }),
  /** PEM private key counterpart of `rsaEncrypt`. */
  z.object({ type: z.literal("rsaDecrypt"), privateKey: z.string().min(1) }),
]);
export type TextCryptoOperation = z.infer<typeof TextCryptoOperationSchema>;

/**
 * Applies a pipeline of hashing/encoding/encryption operations to `input` (interpolated first,
 * same convention as `TextTransformNode.input`).
 */
export const TextCryptoNodeSchema = BaseNodeSchema.extend({
  type: z.literal("textCrypto"),
  input: z.string(),
  operations: z.array(TextCryptoOperationSchema).min(1),
});
export type TextCryptoNode = z.infer<typeof TextCryptoNodeSchema>;

/**
 * Node types allowed inside a `loop` node's body (Specs.md §9.5's "FOR EACH", scoped down — see
 * `LoopNodeSchema` below). Deliberately excludes:
 * - `condition`: a body step is a linear sequence, not a branching target — `Edge.branch` has
 *   nothing to attach to inside an embedded body.
 * - `stop`: would end the *entire workflow* mid-iteration, which is never what "skip this item" or
 *   "break the loop" mean; neither is supported in this iteration.
 * - `loop`: no nested loops in this iteration — keeps the embedded-body model (see below) from
 *   needing its own recursive UI/validation story.
 * - `browserAction`: whether a browser session should be shared or relaunched across iterations
 *   is a real design question of its own, deliberately left for a later iteration rather than
 *   decided implicitly by wiring it in here.
 */
export const LoopBodyNodeSchema = z.discriminatedUnion("type", [
  HttpNodeSchema,
  ExtractNodeSchema,
  DataTransformNodeSchema,
  TextCryptoNodeSchema,
  SetVariableNodeSchema,
]);
export type LoopBodyNode = z.infer<typeof LoopBodyNodeSchema>;

export const LoopOutputMode = z.enum(["list", "last"]);
export type LoopOutputMode = z.infer<typeof LoopOutputMode>;

/**
 * Iterates over an array, running `body` (a small, linear, ordered sequence of steps — never a
 * graph-visible branch with a back-edge) once per element. Deliberately an **embedded body**
 * rather than a set of ordinary graph nodes wired back to this one: the engine's cycle detection
 * and step traversal (`validateDefinition`, `getNextNodeId`, `DEFAULT_MAX_STEPS`) stay untouched,
 * since a loop never introduces an actual cycle into the graph itself.
 *
 * Each iteration gets `{{ item }}` (the current element) and `{{ runtime.index }}` /
 * `{{ runtime.isFirst }}` / `{{ runtime.isLast }}` bound into the expression context — these are
 * pre-existing, generically-resolvable slots (see `ExpressionContext`), not new plumbing. There is
 * no configurable "variable name": every body step reads the current item via the fixed `item`
 * name, the same way every node already reads prior outputs via the fixed `actions` name.
 *
 * `source` is interpolated and must resolve to an array (a config mistake here is loud, not
 * silently coerced). `outputMode` picks what the loop node itself contributes downstream:
 * "list" collects every iteration's last body-step output; "last" keeps only the final one.
 * Either way, only the loop's own output crosses back into the outer scope — body-step outputs
 * are loop-local, so a downstream node is never left guessing which iteration's value a body
 * step's id would refer to.
 */
export const LoopNodeSchema = BaseNodeSchema.extend({
  type: z.literal("loop"),
  source: z.string(),
  body: z.array(LoopBodyNodeSchema).min(1),
  outputMode: LoopOutputMode.default("list"),
});
export type LoopNode = z.infer<typeof LoopNodeSchema>;

/**
 * An optional pause used by several `browserAction` steps below to simulate human timing
 * variation: either a fixed pause (`"fixed"`), or a fresh random duration drawn from
 * `[minMs, maxMs]` **every time the step runs** (`"random"`) — e.g. so replaying the same
 * `moveMouseRandom` step twice doesn't pause for the exact same duration both times, the way a
 * real human never does. `undefined` (the field is optional wherever it's used) means no pause at
 * all, not "instant" as a distinct choice.
 */
export const DelaySpecSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("fixed"), ms: z.number().int().min(0) }),
    z.object({ kind: z.literal("random"), minMs: z.number().int().min(0), maxMs: z.number().int().min(0) }),
  ])
  .refine((delay) => delay.kind !== "random" || delay.maxMs >= delay.minMs, {
    message: "maxMs must be greater than or equal to minMs",
  });
export type DelaySpec = z.infer<typeof DelaySpecSchema>;

/**
 * A single step of a `browserAction` sequence, replayed in order by a real Playwright-driven
 * browser (see `browserActionExecutor.ts` / `apps/browser-worker`'s `/session/run`). Every string
 * field is interpolated the same way `HttpNode.url`/`body` are — see `httpExecutor.ts`.
 */
export const BrowserActionStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string() }),
  z.object({ type: z.literal("click"), selector: z.string() }),
  /**
   * Types character by character (`page.type` / `locator.pressSequentially`) — NEVER
   * `page.fill`, which sets the value directly without dispatching real keyboard events. That
   * distinction is the entire reason this node exists instead of just using `http`: don't
   * "optimize" this to `fill`. `delay` (optional) paces the keystrokes — a `"random"` delay here
   * is what actually produces a human-like typing cadence rather than a perfectly even one.
   */
  z.object({ type: z.literal("type"), selector: z.string(), text: z.string(), delay: DelaySpecSchema.optional() }),
  /** A single key press — "Enter", "Tab", "Escape", … (Playwright key names). */
  z.object({ type: z.literal("press"), key: z.string() }),
  z.object({ type: z.literal("select"), selector: z.string(), value: z.string() }),
  /** A real, intentional mouse hover — e.g. to open a hover-triggered menu. */
  z.object({ type: z.literal("hover"), selector: z.string() }),
  z.object({ type: z.literal("dragTo"), sourceSelector: z.string(), targetSelector: z.string() }),
  z.object({ type: z.literal("scrollIntoView"), selector: z.string() }),
  z.object({ type: z.literal("scrollPage"), x: z.number().default(0), y: z.number() }),
  /** Moves the mouse to an absolute `(x, y)` position of the current viewport — not tied to any
   *  element/selector. `delay` (optional) is a pause taken right after the move settles, to
   *  simulate the brief hesitation a real pointer has before the next action. */
  z.object({ type: z.literal("moveMouse"), x: z.number(), y: z.number(), delay: DelaySpecSchema.optional() }),
  /** Moves the mouse to a random point within the current viewport — idle human-like jitter, not
   *  aimed at any particular element. Same `delay` semantics as `moveMouse`. */
  z.object({ type: z.literal("moveMouseRandom"), delay: DelaySpecSchema.optional() }),
  z.object({ type: z.literal("wait"), ms: z.number().int().positive() }),
  z.object({ type: z.literal("waitForSelector"), selector: z.string() }),
]);
export type BrowserActionStep = z.infer<typeof BrowserActionStepSchema>;

/**
 * Drives a real, Playwright-controlled browser through an ordered sequence of interactive
 * `steps` starting at `startUrl`, then returns the final page HTML once it has fully finished
 * loading (JS included) — see `apps/browser-worker`'s `/session/run`. Unlike `http`, this node
 * can simulate mouse movement, hovering, and real keystroke-level typing, for sites that only
 * reveal their real content in response to genuine interaction.
 *
 * `retryPolicy` is deliberately OMITTED from this schema (not just left unset): the engine wraps
 * every executor call in `withRetry`, and a retry here would replay the *entire* step sequence
 * from the start — including any already-succeeded submit click, for instance. `.strict()` makes
 * that omission actually enforced rather than cosmetic: plain `z.object.omit()` only removes a
 * key from the shape zod *parses into* — by default it still silently strips (rather than
 * rejects) any other unrecognized key passed at runtime, which would let a stray `retryPolicy`
 * on the input object through unnoticed. `.strict()` turns that into a hard validation error, so
 * this can never be silently configured through the union, rather than merely documented as a
 * footgun in the inspector UI.
 */
export const BrowserActionNodeSchema = BaseNodeSchema.omit({ retryPolicy: true })
  .extend({
    type: z.literal("browserAction"),
    startUrl: z.string(),
    steps: z.array(BrowserActionStepSchema).min(1),
    networkMode: NetworkModeSchema,
  })
  .strict();
export type BrowserActionNode = z.infer<typeof BrowserActionNodeSchema>;

export const ActionNodeSchema = z.discriminatedUnion("type", [
  HttpNodeSchema,
  ExtractNodeSchema,
  ConditionNodeSchema,
  SetVariableNodeSchema,
  StopNodeSchema,
  DataTransformNodeSchema,
  TextCryptoNodeSchema,
  LoopNodeSchema,
  BrowserActionNodeSchema,
]);
export type ActionNode = z.infer<typeof ActionNodeSchema>;

export type ActionNodeType = ActionNode["type"];
