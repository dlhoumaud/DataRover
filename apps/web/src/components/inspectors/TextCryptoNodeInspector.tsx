import { useEffect, useRef } from "react";
import { useForm, useFieldArray, useWatch, type Control, type UseFormRegister, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  HashAlgorithm,
  SymmetricCipherAlgorithm,
  TextCryptoNodeSchema,
  TextEncoding,
  type TextCryptoNode,
  type TextCryptoOperation,
} from "@datarover/workflow-types";
import { TemplateInput } from "../TemplateInput";
import type { TemplateVariable } from "../../lib/templateVariables";

/** Same "all fields optional, reshaped on save" approach as TextTransformNodeInspector — see its
 *  doc comment. `algorithm` (hash) and `cipherAlgorithm` (encrypt/decrypt) are separate fields —
 *  they're different enums (HashAlgorithm vs SymmetricCipherAlgorithm), so one shared field
 *  couldn't hold either interchangeably. */
const OPERATION_TYPES = ["hash", "encode", "decode", "encrypt", "decrypt", "rsaEncrypt", "rsaDecrypt"] as const;

const OperationFormSchema = z.object({
  type: z.enum(OPERATION_TYPES),
  algorithm: HashAlgorithm.optional(),
  digest: z.enum(["hex", "base64"]).optional(),
  encoding: TextEncoding.optional(),
  cipherAlgorithm: SymmetricCipherAlgorithm.optional(),
  passphrase: z.string().optional(),
  publicKey: z.string().optional(),
  privateKey: z.string().optional(),
});
type OperationFormValues = z.infer<typeof OperationFormSchema>;

const OPERATION_TYPE_OPTIONS: ReadonlyArray<{ value: OperationFormValues["type"]; label: string }> = [
  { value: "hash", label: "Hacher (hash)" },
  { value: "encode", label: "Encoder" },
  { value: "decode", label: "Décoder" },
  { value: "encrypt", label: "Chiffrer (symétrique)" },
  { value: "decrypt", label: "Déchiffrer (symétrique)" },
  { value: "rsaEncrypt", label: "Chiffrer (RSA, clé publique)" },
  { value: "rsaDecrypt", label: "Déchiffrer (RSA, clé privée)" },
];

/** Every value here is confirmed available on this Node build (`crypto.getHashes()`) — see
 *  HashAlgorithm's own doc comment in @datarover/workflow-types. */
const HASH_ALGORITHM_OPTIONS: HashAlgorithm[] = [
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
];

/** Confirmed available on this Node build (`crypto.getCiphers()`) — single DES/RC4/Blowfish are
 *  deliberately not offered (disabled by default on modern OpenSSL, and broken ciphers besides). */
const CIPHER_ALGORITHM_OPTIONS: SymmetricCipherAlgorithm[] = [
  "aes-128-cbc",
  "aes-192-cbc",
  "aes-256-cbc",
  "aes-128-gcm",
  "aes-192-gcm",
  "aes-256-gcm",
  "des-ede3-cbc",
  "chacha20-poly1305",
];

const ENCODING_OPTIONS: Array<{ value: TextEncoding; label: string }> = [
  { value: "utf8", label: "utf8" },
  { value: "utf16le", label: "utf16le" },
  { value: "latin1", label: "latin1 (iso-8859-1)" },
  { value: "ascii", label: "ascii" },
  { value: "base64", label: "base64" },
  { value: "base64url", label: "base64url" },
  { value: "hex", label: "hex" },
  { value: "url", label: "URL (percent-encoding)" },
];

const TextCryptoFormSchema = TextCryptoNodeSchema.omit({
  id: true,
  type: true,
  operations: true,
  timeoutMs: true,
  retryPolicy: true,
}).extend({
  operations: z.array(OperationFormSchema).min(1, "Au moins une opération"),
});
type TextCryptoFormValues = z.infer<typeof TextCryptoFormSchema>;

function operationToFormValues(operation: TextCryptoOperation): OperationFormValues {
  switch (operation.type) {
    case "hash":
      return { type: "hash", algorithm: operation.algorithm, digest: operation.digest };
    case "encode":
    case "decode":
      return { type: operation.type, encoding: operation.encoding };
    case "encrypt":
    case "decrypt":
      return { type: operation.type, cipherAlgorithm: operation.algorithm, passphrase: operation.passphrase };
    case "rsaEncrypt":
      return { type: "rsaEncrypt", publicKey: operation.publicKey };
    case "rsaDecrypt":
      return { type: "rsaDecrypt", privateKey: operation.privateKey };
    default: {
      const exhaustiveCheck: never = operation;
      throw new Error(`Unsupported operation: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** Returns `null` when a required field is missing — the caller bails the whole save in that case. */
function formValuesToOperation(row: OperationFormValues): TextCryptoOperation | null {
  switch (row.type) {
    case "hash":
      return row.algorithm ? { type: "hash", algorithm: row.algorithm, digest: row.digest ?? "hex" } : null;
    case "encode":
    case "decode":
      return row.encoding ? { type: row.type, encoding: row.encoding } : null;
    case "encrypt":
    case "decrypt":
      return row.passphrase && row.passphrase.length > 0
        ? { type: row.type, algorithm: row.cipherAlgorithm, passphrase: row.passphrase }
        : null;
    case "rsaEncrypt":
      return row.publicKey && row.publicKey.trim().length > 0
        ? { type: "rsaEncrypt", publicKey: row.publicKey.trim() }
        : null;
    case "rsaDecrypt":
      return row.privateKey && row.privateKey.trim().length > 0
        ? { type: "rsaDecrypt", privateKey: row.privateKey.trim() }
        : null;
    default: {
      const exhaustiveCheck: never = row.type;
      throw new Error(`Unsupported operation type: ${String(exhaustiveCheck)}`);
    }
  }
}

function OperationRow({
  control,
  register,
  index,
  onRemove,
  canRemove,
}: {
  control: Control<TextCryptoFormValues>;
  register: UseFormRegister<TextCryptoFormValues>;
  index: number;
  onRemove: () => void;
  canRemove: boolean;
}): JSX.Element {
  const type = useWatch({ control, name: `operations.${index}.type` as Path<TextCryptoFormValues> });

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <select
          {...register(`operations.${index}.type` as Path<TextCryptoFormValues>)}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          {OPERATION_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {canRemove && (
          <button type="button" onClick={onRemove} className="flex-shrink-0 text-xs text-red-500 hover:text-red-700">
            supprimer
          </button>
        )}
      </div>

      {type === "hash" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            {...register(`operations.${index}.algorithm` as Path<TextCryptoFormValues>)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            {HASH_ALGORITHM_OPTIONS.map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {algorithm}
              </option>
            ))}
          </select>
          <select
            {...register(`operations.${index}.digest` as Path<TextCryptoFormValues>)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="hex">hex</option>
            <option value="base64">base64</option>
          </select>
        </div>
      )}

      {(type === "encode" || type === "decode") && (
        <div className="mt-2">
          <select
            {...register(`operations.${index}.encoding` as Path<TextCryptoFormValues>)}
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            {ENCODING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {(type === "encrypt" || type === "decrypt") && (
        <div className="mt-2 space-y-2">
          <select
            {...register(`operations.${index}.cipherAlgorithm` as Path<TextCryptoFormValues>)}
            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            {CIPHER_ALGORITHM_OPTIONS.map((algorithm) => (
              <option key={algorithm} value={algorithm}>
                {algorithm}
              </option>
            ))}
          </select>
          <input
            {...register(`operations.${index}.passphrase` as Path<TextCryptoFormValues>)}
            placeholder="Passphrase"
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
          <p className="text-xs text-gray-400">
            Même algorithme et même passphrase requis pour chiffrer et déchiffrer.
          </p>
        </div>
      )}

      {type === "rsaEncrypt" && (
        <div className="mt-2">
          <textarea
            {...register(`operations.${index}.publicKey` as Path<TextCryptoFormValues>)}
            placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
            rows={4}
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-gray-400">
            Clé publique PEM (RSA-OAEP/SHA-256). La taille du texte source est limitée par la
            taille de la clé (≈190 octets pour une clé 2048 bits).
          </p>
        </div>
      )}

      {type === "rsaDecrypt" && (
        <div className="mt-2">
          <textarea
            {...register(`operations.${index}.privateKey` as Path<TextCryptoFormValues>)}
            placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
            rows={4}
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-gray-400">Clé privée PEM correspondante.</p>
        </div>
      )}
    </div>
  );
}

export function TextCryptoNodeInspector({
  node,
  onChange,
  variables = [],
}: {
  node: TextCryptoNode;
  onChange: (updated: TextCryptoNode) => void;
  /** `{{ }}` autocomplete entries for "Texte source" — see TemplateInput. Optional (default
   *  `[]`) so LoopNodeInspector's embedded-body usage doesn't need updating at the same time. */
  variables?: TemplateVariable[];
}): JSX.Element {
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastSentRef = useRef<string | null>(null);

  const {
    register,
    control,
    formState: { errors },
  } = useForm<TextCryptoFormValues>({
    resolver: zodResolver(TextCryptoFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      input: node.input,
      operations: node.operations.map(operationToFormValues),
    },
  });

  const operationsArray = useFieldArray({ control, name: "operations" });
  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = TextCryptoFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const operations = parsed.data.operations.map(formValuesToOperation);
    if (operations.some((operation) => operation === null)) {
      return;
    }
    const updated: TextCryptoNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      input: parsed.data.input,
      operations: operations as TextCryptoOperation[],
    };
    const serialized = JSON.stringify(updated);
    const isFirstRun = lastSentRef.current === null;
    if (serialized === lastSentRef.current) {
      return;
    }
    lastSentRef.current = serialized;
    if (isFirstRun) {
      return;
    }
    onChangeRef.current(updated);
  }, [watchedValues]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Nom</label>
        <input
          {...register("name")}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Texte source</label>
        <TemplateInput
          registration={register("input")}
          variables={variables}
          placeholder="{{ actions.extract1.output.id }}"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Opérations (appliquées dans l&apos;ordre)</span>
          <button
            type="button"
            onClick={() => operationsArray.append({ type: "hash", algorithm: "sha256", digest: "hex" })}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            + ajouter une opération
          </button>
        </div>
        {errors.operations?.root?.message && (
          <p className="mt-1 text-xs text-red-600">{errors.operations.root.message}</p>
        )}
        <div className="mt-2 space-y-2">
          {operationsArray.fields.map((field, index) => (
            <OperationRow
              key={field.id}
              control={control}
              register={register}
              index={index}
              canRemove={operationsArray.fields.length > 1}
              onRemove={() => operationsArray.remove(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
