import { useEffect, useRef } from "react";
import { useForm, useFieldArray, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { SetVariableNodeSchema, type SetVariableNode } from "@datarover/workflow-types";
import { TemplateInput } from "../TemplateInput";
import type { TemplateVariable } from "../../lib/templateVariables";

/**
 * Form schema derived from `SetVariableNodeSchema`: `variables` (domain:
 * `Record<string, string>`) is reshaped into a key/value pair array for
 * `useFieldArray`.
 */
const SetVariableFormSchema = SetVariableNodeSchema.omit({
  id: true,
  type: true,
  variables: true,
  timeoutMs: true,
  retryPolicy: true,
}).extend({
  variables: z.array(z.object({ key: z.string().min(1, "Nom de variable requis"), value: z.string() })),
});

type SetVariableFormValues = z.infer<typeof SetVariableFormSchema>;

function recordToPairs(record: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function pairsToRecord(pairs: Array<{ key: string; value: string }>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const pair of pairs) {
    if (pair.key.trim().length > 0) {
      record[pair.key] = pair.value;
    }
  }
  return record;
}

export function SetVariableNodeInspector({
  node,
  onChange,
  variables = [],
}: {
  node: SetVariableNode;
  onChange: (updated: SetVariableNode) => void;
  /** `{{ }}` autocomplete entries for each variable's value field — see TemplateInput. Optional
   *  (default `[]`) so LoopNodeInspector's embedded-body usage doesn't need updating at the same
   *  time. */
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
  } = useForm<SetVariableFormValues>({
    resolver: zodResolver(SetVariableFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      variables: recordToPairs(node.variables),
    },
  });

  const variablesArray = useFieldArray({ control, name: "variables" });
  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = SetVariableFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const updated: SetVariableNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      variables: pairsToRecord(parsed.data.variables),
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
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Variables</span>
          <button
            type="button"
            onClick={() => variablesArray.append({ key: "", value: "" })}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            + ajouter
          </button>
        </div>
        <div className="mt-1 space-y-1.5">
          {variablesArray.fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-1.5">
              <input
                {...register(`variables.${index}.key` as Path<SetVariableFormValues>)}
                placeholder="Nom de variable"
                className="w-1/3 rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
              />
              <TemplateInput
                registration={register(`variables.${index}.value` as Path<SetVariableFormValues>)}
                variables={variables}
                placeholder="{{ actions.http1.output.title }}"
                wrapperClassName="flex-1"
                className="w-full rounded-md border border-gray-300 px-2 py-1 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => variablesArray.remove(index)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                supprimer
              </button>
            </div>
          ))}
          {variablesArray.fields.length === 0 && (
            <p className="text-xs text-gray-400">Aucune variable.</p>
          )}
        </div>
      </div>
    </div>
  );
}
