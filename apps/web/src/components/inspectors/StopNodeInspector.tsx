import { useEffect, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { StopNodeSchema, type StopNode } from "@datarover/workflow-types";

const StopFormSchema = StopNodeSchema.omit({
  id: true,
  type: true,
  timeoutMs: true,
  retryPolicy: true,
});

type StopFormValues = z.infer<typeof StopFormSchema>;

export function StopNodeInspector({
  node,
  onChange,
}: {
  node: StopNode;
  onChange: (updated: StopNode) => void;
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
  } = useForm<StopFormValues>({
    resolver: zodResolver(StopFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      reason: node.reason ?? "",
    },
  });

  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = StopFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const trimmedReason = parsed.data.reason?.trim();
    const updated: StopNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      reason: trimmedReason && trimmedReason.length > 0 ? trimmedReason : undefined,
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
        <label className="block text-sm font-medium text-gray-700">Raison (optionnel)</label>
        <input
          {...register("reason")}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}
