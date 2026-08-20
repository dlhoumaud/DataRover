import { useEffect, useRef } from "react";
import { useForm, useFieldArray, useWatch, type Control, type UseFormRegister, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DataTransformNodeSchema,
  type DataInputType,
  type DataOutputType,
  type DataTransformNode,
  type DataTransformOperation,
} from "@datarover/workflow-types";
import { TemplateInput } from "../TemplateInput";
import type { TemplateVariable } from "../../lib/templateVariables";

/** Same "all fields optional, reshaped on save" approach used throughout this app's node
 *  inspectors (see e.g. TextCryptoNodeInspector) — only the fields relevant to a row's current
 *  `type` are ever shown or read back (see `formValuesToOperation`). */
const OPERATION_TYPES = [
  "lower",
  "upper",
  "capitalize",
  "replace",
  "regexReplace",
  "slice",
  "trim",
  "trimStart",
  "trimEnd",
  "padStart",
  "padEnd",
  "getPath",
  "keys",
  "values",
  "toArray",
  "length",
  "stringify",
  "toInt",
  "toFloat",
  "toBoolean",
] as const;

const OperationFormSchema = z.object({
  type: z.enum(OPERATION_TYPES),
  search: z.string().optional(),
  replacement: z.string().optional(),
  all: z.boolean().optional(),
  pattern: z.string().optional(),
  flags: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  length: z.string().optional(),
  char: z.string().optional(),
  path: z.string().optional(),
});
type OperationFormValues = z.infer<typeof OperationFormSchema>;

/** Offered when `inputType` is "raw" — pure string edits. */
const STRING_OPERATION_OPTIONS: ReadonlyArray<{ value: OperationFormValues["type"]; label: string }> = [
  { value: "lower", label: "minuscules (lower)" },
  { value: "upper", label: "MAJUSCULES (upper)" },
  { value: "capitalize", label: "Première lettre en majuscule" },
  { value: "replace", label: "Remplacement" },
  { value: "regexReplace", label: "Regex (remplacement)" },
  { value: "slice", label: "Sous-chaîne (slice)" },
  { value: "trim", label: "Trim (les deux côtés)" },
  { value: "trimStart", label: "Trim gauche (ltrim)" },
  { value: "trimEnd", label: "Trim droite (rtrim)" },
  { value: "padStart", label: "Complément à gauche (padleft)" },
  { value: "padEnd", label: "Complément à droite (padright)" },
];

/** Offered when `inputType` is "json"/"yaml"/"xml" — operations on the parsed value. */
const STRUCTURED_OPERATION_OPTIONS: ReadonlyArray<{ value: OperationFormValues["type"]; label: string }> = [
  { value: "getPath", label: "Extraire un chemin (JSONPath)" },
  { value: "keys", label: "Clés de l'objet" },
  { value: "values", label: "Valeurs de l'objet" },
  { value: "toArray", label: "Convertir en tableau" },
  { value: "length", label: "Longueur / nombre d'éléments" },
  { value: "stringify", label: "Sérialiser en JSON" },
];

/** Offered regardless of `inputType` — scalar coercions. */
const SCALAR_OPERATION_OPTIONS: ReadonlyArray<{ value: OperationFormValues["type"]; label: string }> = [
  { value: "toInt", label: "Convertir en entier" },
  { value: "toFloat", label: "Convertir en décimal" },
  { value: "toBoolean", label: "Convertir en booléen" },
];

const INPUT_TYPE_OPTIONS: ReadonlyArray<{ value: DataInputType; label: string }> = [
  { value: "raw", label: "Brute (texte)" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
];

const OUTPUT_TYPE_OPTIONS: ReadonlyArray<{ value: DataOutputType; label: string }> = [
  { value: "text", label: "Texte" },
  { value: "list", label: "Liste" },
  { value: "table", label: "Tableau" },
  { value: "int", label: "Entier" },
  { value: "float", label: "Décimal" },
  { value: "boolean", label: "Booléen" },
];

/**
 * What output type the LAST operation in the pipeline naturally produces — the inspector auto-sets
 * `outputType` to this whenever the last row's operation type changes (see the effect below), so
 * the declared output always matches what the pipeline actually does, without the user having to
 * remember to update it by hand. Still a normal, editable field afterward: e.g. `getPath` can
 * reach any shape of value depending on the document, so its mapped default ("text" — a JSON
 * document/attribute path result is not statically knowable ahead of time) is only a starting
 * point, not a guarantee — the executor's own coercion step (`dataTransformExecutor.ts`) is what
 * actually normalizes the final value to whatever `outputType` ends up declaring.
 */
const OPERATION_OUTPUT_TYPE: Record<OperationFormValues["type"], DataOutputType> = {
  lower: "text",
  upper: "text",
  capitalize: "text",
  replace: "text",
  regexReplace: "text",
  slice: "text",
  trim: "text",
  trimStart: "text",
  trimEnd: "text",
  padStart: "text",
  padEnd: "text",
  getPath: "text",
  stringify: "text",
  keys: "list",
  values: "list",
  toArray: "list",
  length: "int",
  toInt: "int",
  toFloat: "float",
  toBoolean: "boolean",
};

const DataTransformFormSchema = DataTransformNodeSchema.omit({
  id: true,
  type: true,
  operations: true,
  timeoutMs: true,
  retryPolicy: true,
}).extend({
  operations: z.array(OperationFormSchema).min(1, "Au moins une opération"),
});
type DataTransformFormValues = z.infer<typeof DataTransformFormSchema>;

function operationToFormValues(operation: DataTransformOperation): OperationFormValues {
  switch (operation.type) {
    case "replace":
      return { type: "replace", search: operation.search, replacement: operation.replacement, all: operation.all };
    case "regexReplace":
      return {
        type: "regexReplace",
        pattern: operation.pattern,
        flags: operation.flags,
        replacement: operation.replacement,
      };
    case "slice":
      return {
        type: "slice",
        start: String(operation.start),
        end: operation.end !== undefined ? String(operation.end) : "",
      };
    case "padStart":
    case "padEnd":
      return { type: operation.type, length: String(operation.length), char: operation.char };
    case "getPath":
      return { type: "getPath", path: operation.path };
    default:
      return { type: operation.type };
  }
}

/** Returns `null` when a required field is missing/invalid — the caller bails the whole save in that case. */
function formValuesToOperation(row: OperationFormValues): DataTransformOperation | null {
  switch (row.type) {
    case "lower":
    case "upper":
    case "capitalize":
    case "trim":
    case "trimStart":
    case "trimEnd":
    case "keys":
    case "values":
    case "toArray":
    case "length":
    case "stringify":
    case "toInt":
    case "toFloat":
    case "toBoolean":
      return { type: row.type };
    case "replace":
      return {
        type: "replace",
        search: row.search ?? "",
        replacement: row.replacement ?? "",
        all: row.all ?? false,
      };
    case "regexReplace":
      return {
        type: "regexReplace",
        pattern: row.pattern ?? "",
        flags: row.flags ?? "",
        replacement: row.replacement ?? "",
      };
    case "slice": {
      const start = Number(row.start ?? "0");
      if (!Number.isInteger(start)) {
        return null;
      }
      const trimmedEnd = row.end?.trim() ?? "";
      if (trimmedEnd.length === 0) {
        return { type: "slice", start };
      }
      const end = Number(trimmedEnd);
      return Number.isInteger(end) ? { type: "slice", start, end } : null;
    }
    case "padStart":
    case "padEnd": {
      const length = Number(row.length ?? "0");
      if (!Number.isInteger(length) || length < 0) {
        return null;
      }
      return { type: row.type, length, char: row.char && row.char.length > 0 ? row.char : " " };
    }
    case "getPath":
      return row.path && row.path.trim().length > 0 ? { type: "getPath", path: row.path.trim() } : null;
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
  inputType,
  onRemove,
  canRemove,
}: {
  control: Control<DataTransformFormValues>;
  register: UseFormRegister<DataTransformFormValues>;
  index: number;
  inputType: DataInputType;
  onRemove: () => void;
  canRemove: boolean;
}): JSX.Element {
  const type = useWatch({ control, name: `operations.${index}.type` as Path<DataTransformFormValues> });
  const catalog = inputType === "raw" ? STRING_OPERATION_OPTIONS : STRUCTURED_OPERATION_OPTIONS;

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center gap-2">
        <select
          {...register(`operations.${index}.type` as Path<DataTransformFormValues>)}
          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          <optgroup label={inputType === "raw" ? "Texte" : "Données structurées"}>
            {catalog.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Conversion de type">
            {SCALAR_OPERATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        </select>
        {canRemove && (
          <button type="button" onClick={onRemove} className="flex-shrink-0 text-xs text-red-500 hover:text-red-700">
            supprimer
          </button>
        )}
      </div>

      {type === "replace" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            {...register(`operations.${index}.search` as Path<DataTransformFormValues>)}
            placeholder="Rechercher"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            {...register(`operations.${index}.replacement` as Path<DataTransformFormValues>)}
            placeholder="Remplacer par"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <label className="col-span-2 flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" {...register(`operations.${index}.all` as Path<DataTransformFormValues>)} />
            Toutes les occurrences
          </label>
        </div>
      )}

      {type === "regexReplace" && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <input
            {...register(`operations.${index}.pattern` as Path<DataTransformFormValues>)}
            placeholder="Pattern (ex: [0-9]+)"
            className="rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
          <input
            {...register(`operations.${index}.flags` as Path<DataTransformFormValues>)}
            placeholder="Flags (g, i, gi...)"
            className="rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
          <input
            {...register(`operations.${index}.replacement` as Path<DataTransformFormValues>)}
            placeholder="Remplacer par"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      )}

      {type === "slice" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="number"
            {...register(`operations.${index}.start` as Path<DataTransformFormValues>)}
            placeholder="Début"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            type="number"
            {...register(`operations.${index}.end` as Path<DataTransformFormValues>)}
            placeholder="Fin (optionnel)"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      )}

      {(type === "padStart" || type === "padEnd") && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="number"
            {...register(`operations.${index}.length` as Path<DataTransformFormValues>)}
            placeholder="Longueur cible"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <input
            {...register(`operations.${index}.char` as Path<DataTransformFormValues>)}
            placeholder="Caractère (défaut: espace)"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
      )}

      {type === "getPath" && (
        <div className="mt-2">
          <input
            {...register(`operations.${index}.path` as Path<DataTransformFormValues>)}
            placeholder="$.items[0].price"
            className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">JSONPath — même syntaxe que le node Extraction.</p>
        </div>
      )}
    </div>
  );
}

export function DataTransformNodeInspector({
  node,
  onChange,
  variables = [],
}: {
  node: DataTransformNode;
  onChange: (updated: DataTransformNode) => void;
  /** `{{ }}` autocomplete entries for the "Donnée source" field — see TemplateInput. Optional
   *  (default `[]`, autocomplete simply offers nothing) so this inspector's existing callers
   *  inside LoopNodeInspector's embedded body don't all need updating at once. */
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
    setValue,
    formState: { errors },
  } = useForm<DataTransformFormValues>({
    resolver: zodResolver(DataTransformFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      input: node.input,
      inputType: node.inputType,
      operations: node.operations.map(operationToFormValues),
      outputType: node.outputType,
    },
  });

  const operationsArray = useFieldArray({ control, name: "operations" });
  const watchedValues = useWatch({ control });
  const inputType = useWatch({ control, name: "inputType" });

  // Auto-sets outputType from the LAST operation's natural result type whenever it changes — see
  // OPERATION_OUTPUT_TYPE's doc comment. Runs on every render (cheap: a string comparison plus,
  // at most, one form field write) rather than a dependency-tracked effect, so it also re-applies
  // right after a row is added/removed, when "the last operation" itself changes identity.
  const lastOperationType = watchedValues.operations?.at(-1)?.type;
  const lastSyncedOperationTypeRef = useRef<string | undefined>(undefined);
  if (lastOperationType && lastOperationType !== lastSyncedOperationTypeRef.current) {
    lastSyncedOperationTypeRef.current = lastOperationType;
    setValue("outputType", OPERATION_OUTPUT_TYPE[lastOperationType]);
  }

  useEffect(() => {
    const parsed = DataTransformFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const operations = parsed.data.operations.map(formValuesToOperation);
    if (operations.some((operation) => operation === null)) {
      return;
    }
    const updated: DataTransformNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      input: parsed.data.input,
      inputType: parsed.data.inputType,
      operations: operations as DataTransformOperation[],
      outputType: parsed.data.outputType,
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
        <label className="block text-sm font-medium text-gray-700">Donnée source</label>
        <TemplateInput
          registration={register("input")}
          variables={variables}
          placeholder="{{ actions.extract1.output.title }}"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Type d&apos;entrée</label>
          <select
            {...register("inputType")}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {INPUT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Type de sortie</label>
          <select
            {...register("outputType")}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {OUTPUT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-400">Mis à jour automatiquement d&apos;après la dernière opération.</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Opérations (appliquées dans l&apos;ordre)</span>
          <button
            type="button"
            onClick={() => operationsArray.append({ type: inputType === "raw" ? "trim" : "getPath" })}
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
              inputType={inputType}
              canRemove={operationsArray.fields.length > 1}
              onRemove={() => operationsArray.remove(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
