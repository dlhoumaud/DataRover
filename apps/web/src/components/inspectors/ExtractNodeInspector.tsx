import { useEffect, useRef } from "react";
import {
  useForm,
  useFieldArray,
  useWatch,
  type Control,
  type UseFormRegister,
  type Path,
  type FieldArrayPath,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ExtractNodeSchema,
  ExtractionRuleSchema,
  type ExtractNode,
  type ExtractionRule,
  type ExtractStrategyType,
  type ExtractOutputType,
} from "@datarover/workflow-types";

/**
 * Form schema for a single extraction rule: reuses the atomic field schemas
 * from `ExtractionRuleSchema` for `name`/`strategy`/`attribute`/`output`,
 * and reshapes `selectors` (domain: `string[]`) into an array of
 * `{ value: string }` objects, as required by `useFieldArray`.
 */
const ExtractionRuleFormSchema = z.object({
  name: ExtractionRuleSchema.shape.name,
  strategy: ExtractionRuleSchema.shape.strategy,
  selectors: z
    .array(z.object({ value: z.string().min(1, "Sélecteur requis") }))
    .min(1, "Au moins un sélecteur"),
  attribute: ExtractionRuleSchema.shape.attribute,
  output: ExtractionRuleSchema.shape.output,
});

/**
 * Form schema derived from `ExtractNodeSchema`: scalar fields (name, source,
 * sourceType) are reused as-is; `rules` is reshaped via
 * `ExtractionRuleFormSchema` above.
 */
const ExtractFormSchema = ExtractNodeSchema.omit({
  id: true,
  type: true,
  rules: true,
  timeoutMs: true,
  retryPolicy: true,
}).extend({
  rules: z.array(ExtractionRuleFormSchema).min(1, "Au moins une règle"),
});

type ExtractFormValues = z.infer<typeof ExtractFormSchema>;

function ruleToFormValues(rule: ExtractionRule): ExtractFormValues["rules"][number] {
  return {
    name: rule.name,
    strategy: rule.strategy,
    selectors: rule.selectors.map((selector) => ({ value: selector })),
    attribute: rule.attribute,
    output: rule.output,
  };
}

function formValuesToRule(rule: ExtractFormValues["rules"][number]): ExtractionRule {
  return {
    name: rule.name,
    strategy: rule.strategy,
    selectors: rule.selectors.map((selector) => selector.value),
    attribute: rule.strategy === "css" && rule.output === "attribute" ? rule.attribute : undefined,
    output: rule.output,
  };
}

function RuleRow({
  control,
  register,
  ruleIndex,
  onRemoveRule,
  canRemoveRule,
}: {
  control: Control<ExtractFormValues>;
  register: UseFormRegister<ExtractFormValues>;
  ruleIndex: number;
  onRemoveRule: () => void;
  canRemoveRule: boolean;
}): JSX.Element {
  const selectorsArray = useFieldArray({
    control,
    name: `rules.${ruleIndex}.selectors` as FieldArrayPath<ExtractFormValues>,
  });

  const strategy = useWatch({
    control,
    name: `rules.${ruleIndex}.strategy` as Path<ExtractFormValues>,
  }) as ExtractStrategyType;
  const output = useWatch({
    control,
    name: `rules.${ruleIndex}.output` as Path<ExtractFormValues>,
  }) as ExtractOutputType;

  const showAttribute = strategy === "css" && output === "attribute";

  return (
    <div className="rounded-md border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-gray-500">Règle {ruleIndex + 1}</span>
        {canRemoveRule && (
          <button type="button" onClick={onRemoveRule} className="text-xs text-red-500 hover:text-red-700">
            supprimer la règle
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700">Nom</label>
          <input
            {...register(`rules.${ruleIndex}.name` as Path<ExtractFormValues>)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700">Stratégie</label>
          <select
            {...register(`rules.${ruleIndex}.strategy` as Path<ExtractFormValues>)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="css">css</option>
            <option value="xpath">xpath</option>
            <option value="jsonpath">jsonpath</option>
            <option value="regex">regex</option>
          </select>
        </div>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">Sélecteurs (ordre de repli)</span>
          <button
            type="button"
            onClick={() => selectorsArray.append({ value: "" })}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            + ajouter
          </button>
        </div>
        <div className="mt-1 space-y-1.5">
          {selectorsArray.fields.map((field, selectorIndex) => (
            <div key={field.id} className="flex items-center gap-1.5">
              <input
                {...register(
                  `rules.${ruleIndex}.selectors.${selectorIndex}.value` as Path<ExtractFormValues>,
                )}
                className="flex-1 rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
              />
              {selectorsArray.fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => selectorsArray.remove(selectorIndex)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  supprimer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700">Sortie</label>
          <select
            {...register(`rules.${ruleIndex}.output` as Path<ExtractFormValues>)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="text">text</option>
            <option value="attribute">attribute</option>
            <option value="list">list</option>
            <option value="table">table</option>
            <option value="value">value</option>
          </select>
        </div>
        {showAttribute && (
          <div>
            <label className="block text-xs font-medium text-gray-700">Attribut</label>
            <input
              {...register(`rules.${ruleIndex}.attribute` as Path<ExtractFormValues>)}
              placeholder="href, src, ..."
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function ExtractNodeInspector({
  node,
  availableNodeIds,
  onChange,
}: {
  node: ExtractNode;
  availableNodeIds: string[];
  onChange: (updated: ExtractNode) => void;
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
  } = useForm<ExtractFormValues>({
    resolver: zodResolver(ExtractFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      source: node.source,
      sourceType: node.sourceType,
      rules: node.rules.map(ruleToFormValues),
    },
  });

  const rulesArray = useFieldArray({ control, name: "rules" });
  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = ExtractFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const updated: ExtractNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      source: parsed.data.source,
      sourceType: parsed.data.sourceType,
      rules: parsed.data.rules.map(formValuesToRule),
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Source</label>
          <select
            {...register("source")}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">-- sélectionner --</option>
            {availableNodeIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Type de source</label>
          <select
            {...register("sourceType")}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="html">html</option>
            <option value="json">json</option>
            <option value="xml">xml</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Règles d'extraction</span>
          <button
            type="button"
            onClick={() =>
              rulesArray.append({
                name: "",
                strategy: "css",
                selectors: [{ value: "" }],
                attribute: undefined,
                output: "text",
              })
            }
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            + ajouter une règle
          </button>
        </div>
        {errors.rules?.root?.message && (
          <p className="mt-1 text-xs text-red-600">{errors.rules.root.message}</p>
        )}
        <div className="mt-2 space-y-2">
          {rulesArray.fields.map((field, index) => (
            <RuleRow
              key={field.id}
              control={control}
              register={register}
              ruleIndex={index}
              canRemoveRule={rulesArray.fields.length > 1}
              onRemoveRule={() => rulesArray.remove(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
