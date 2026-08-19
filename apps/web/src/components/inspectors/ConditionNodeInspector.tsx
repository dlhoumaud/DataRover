import { useEffect, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { ConditionNodeSchema, type ConditionNode } from "@datarover/workflow-types";

const ConditionFormSchema = ConditionNodeSchema.omit({
  id: true,
  type: true,
  timeoutMs: true,
  retryPolicy: true,
});

type ConditionFormValues = z.infer<typeof ConditionFormSchema>;

export function ConditionNodeInspector({
  node,
  onChange,
}: {
  node: ConditionNode;
  onChange: (updated: ConditionNode) => void;
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
  } = useForm<ConditionFormValues>({
    resolver: zodResolver(ConditionFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      expression: node.expression,
    },
  });

  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = ConditionFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const updated: ConditionNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      expression: parsed.data.expression,
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
        <label className="block text-sm font-medium text-gray-700">Expression</label>
        <textarea
          {...register("expression")}
          rows={4}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">
          Ex: actions.extractPrice.output.firstPrice &lt; global.targetPrice — les ids de node
          référencés doivent être en camelCase, sans tiret.
        </p>
        {errors.expression && <p className="mt-1 text-xs text-red-600">{errors.expression.message}</p>}
      </div>
    </div>
  );
}
