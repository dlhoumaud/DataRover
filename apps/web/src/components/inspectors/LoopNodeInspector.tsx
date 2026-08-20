import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import {
  LoopNodeSchema,
  type ActionNode,
  type LoopBodyNode,
  type LoopNode,
} from "@datarover/workflow-types";
import { generateNodeId } from "../../lib/workflowGraph";
import { NODE_COLORS, NODE_LABELS } from "../../lib/nodeStyles";
import { HttpNodeInspector } from "./HttpNodeInspector";
import { ExtractNodeInspector } from "./ExtractNodeInspector";
import { DataTransformNodeInspector } from "./DataTransformNodeInspector";
import { TextCryptoNodeInspector } from "./TextCryptoNodeInspector";
import { SetVariableNodeInspector } from "./SetVariableNodeInspector";

/**
 * Form schema for the loop's own scalar fields — `body` is deliberately excluded here (and
 * managed as plain, directly-mutated state below, not through this form) since each element is a
 * *full* `ActionNode` edited via that node type's own existing inspector, not a set of atomic form
 * fields this component would otherwise have to re-derive.
 */
const LoopFormSchema = LoopNodeSchema.omit({
  id: true,
  type: true,
  body: true,
  timeoutMs: true,
  retryPolicy: true,
});

type LoopFormValues = z.infer<typeof LoopFormSchema>;

/** Node types a loop body step may be — see `LoopBodyNodeSchema`'s doc comment for why the rest
 * (`condition`, `stop`, `loop`) are excluded. */
const BODY_STEP_TYPES: ReadonlyArray<LoopBodyNode["type"]> = [
  "http",
  "extract",
  "dataTransform",
  "textCrypto",
  "setVariable",
];

/**
 * Inspector for `loop` nodes ("Boucle"): the loop's own fields (name, `source` — a `{{ }}`
 * template that must resolve to an array, output mode) plus an editor for its **embedded body** —
 * a small ordered list of steps run once per item (see `LoopNodeSchema`'s doc comment for the
 * design rationale: this is not a graph-visible sub-flow, just a linear sequence stored on the
 * node itself).
 *
 * Each body step is edited via the *same* inspector component its type already uses elsewhere in
 * the editor (`HttpNodeInspector`, `ExtractNodeInspector`, ...), collapsed by default and
 * expandable one at a time. Two differences from top-level usage, both deliberate scope cuts for
 * this iteration:
 * - `HttpNodeInspector` is used without `projectId`/`onCreateExtractNode` (both optional — see its
 *   own doc comment): wiring the HTML-preview-to-extract-node flow recursively into a nested loop
 *   body is out of scope here, so its preview button simply doesn't render.
 * - `ExtractNodeInspector`'s `availableNodeIds` is populated with only the **preceding** body
 *   steps' ids (sequential visibility — a step can reference an earlier one's output, never a
 *   later one it hasn't run yet, and never a step in a different iteration).
 *
 * Steps can be added (appended) or removed (down to the schema-required minimum of one), but not
 * reordered — array position is fixed once created, an explicit scope cut for this iteration.
 */
export function LoopNodeInspector({
  node,
  onChange,
}: {
  node: LoopNode;
  onChange: (updated: LoopNode) => void;
}): JSX.Element {
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastSentRef = useRef<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const {
    register,
    control,
    formState: { errors },
  } = useForm<LoopFormValues>({
    resolver: zodResolver(LoopFormSchema),
    mode: "onChange",
    defaultValues: {
      name: node.name,
      source: node.source,
      outputMode: node.outputMode,
    },
  });

  const watchedValues = useWatch({ control });

  useEffect(() => {
    const parsed = LoopFormSchema.safeParse(watchedValues);
    if (!parsed.success) {
      return;
    }
    const updated: LoopNode = {
      ...nodeRef.current,
      name: parsed.data.name,
      source: parsed.data.source,
      outputMode: parsed.data.outputMode,
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

  function handleStepChange(index: number, updatedStep: LoopBodyNode): void {
    const updatedBody = nodeRef.current.body.map((step, i) => (i === index ? updatedStep : step));
    onChangeRef.current({ ...nodeRef.current, body: updatedBody });
  }

  function handleAddStep(type: LoopBodyNode["type"]): void {
    const existingIds = new Set(nodeRef.current.body.map((step) => step.id));
    const id = generateNodeId(type, existingIds);
    const newStep = createDefaultBodyNode(type, id);
    const updatedBody = [...nodeRef.current.body, newStep];
    onChangeRef.current({ ...nodeRef.current, body: updatedBody });
    setExpandedIndex(updatedBody.length - 1);
  }

  function handleRemoveStep(index: number): void {
    if (nodeRef.current.body.length <= 1) {
      return;
    }
    const updatedBody = nodeRef.current.body.filter((_, i) => i !== index);
    onChangeRef.current({ ...nodeRef.current, body: updatedBody });
    setExpandedIndex(null);
  }

  function renderStepInspector(step: LoopBodyNode, index: number): JSX.Element {
    const onStepChange = (updated: ActionNode): void => handleStepChange(index, updated as LoopBodyNode);
    switch (step.type) {
      case "http":
        return <HttpNodeInspector key={step.id} node={step} onChange={onStepChange} />;
      case "extract":
        return (
          <ExtractNodeInspector
            key={step.id}
            node={step}
            availableNodeIds={node.body.slice(0, index).map((preceding) => preceding.id)}
            onChange={onStepChange}
          />
        );
      case "dataTransform":
        return <DataTransformNodeInspector key={step.id} node={step} onChange={onStepChange} />;
      case "textCrypto":
        return <TextCryptoNodeInspector key={step.id} node={step} onChange={onStepChange} />;
      case "setVariable":
        return <SetVariableNodeInspector key={step.id} node={step} onChange={onStepChange} />;
      default: {
        const exhaustiveCheck: never = step;
        throw new Error(`Type d'étape de boucle non supporté: ${String((exhaustiveCheck as LoopBodyNode).type)}`);
      }
    }
  }

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
        <label className="block text-sm font-medium text-gray-700">Source (liste/tableau)</label>
        <input
          {...register("source")}
          placeholder="{{ actions.extraction.output.items }}"
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-400">
          Doit s&apos;évaluer en tableau — chaque élément est disponible dans les étapes ci-dessous
          via <span className="font-mono">{"{{ item }}"}</span>, sa position via{" "}
          <span className="font-mono">{"{{ runtime.index }}"}</span>.
        </p>
        {errors.source && <p className="mt-1 text-xs text-red-600">{errors.source.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Sortie de la boucle</label>
        <select
          {...register("outputMode")}
          className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="list">list — le résultat de chaque itération</option>
          <option value="last">last — seulement la dernière itération</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Étapes (exécutées à chaque itération)</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {BODY_STEP_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => handleAddStep(type)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              + {NODE_LABELS[type]}
            </button>
          ))}
        </div>

        <div className="mt-2 space-y-2">
          {node.body.map((step, index) => (
            <div key={step.id} className="rounded-md border border-gray-200">
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setExpandedIndex((current) => (current === index ? null : index))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span className="flex-shrink-0 text-xs text-gray-400" aria-hidden="true">
                    {expandedIndex === index ? "▾" : "▸"}
                  </span>
                  <span className="flex-shrink-0 text-xs font-semibold text-gray-400">{index + 1}.</span>
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${NODE_COLORS[step.type]}`}
                    aria-hidden="true"
                  />
                  <span className="truncate text-sm text-gray-900">{step.name}</span>
                  <span className="flex-shrink-0 text-xs text-gray-400">({NODE_LABELS[step.type]})</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveStep(index)}
                  disabled={node.body.length <= 1}
                  className="flex-shrink-0 text-xs text-red-500 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  supprimer
                </button>
              </div>
              {expandedIndex === index && (
                <div className="border-t border-gray-200 px-2 py-2">{renderStepInspector(step, index)}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function createDefaultBodyNode(type: LoopBodyNode["type"], id: string): LoopBodyNode {
  switch (type) {
    case "http":
      return { id, name: "Nouvelle requête HTTP", type: "http", method: "GET", url: "", responseType: "json" };
    case "extract":
      return {
        id,
        name: "Nouvelle extraction",
        type: "extract",
        source: "",
        sourceType: "json",
        rules: [{ name: "value", strategy: "jsonpath", selectors: ["$"], output: "value" }],
      };
    case "dataTransform":
      return {
        id,
        name: "Nouveau traitement",
        type: "dataTransform",
        input: "",
        inputType: "raw",
        operations: [{ type: "trim" }],
        outputType: "text",
      };
    case "textCrypto":
      return {
        id,
        name: "Nouvelle crypto",
        type: "textCrypto",
        input: "",
        operations: [{ type: "hash", algorithm: "sha256", digest: "hex" }],
      };
    case "setVariable":
      return { id, name: "Nouvelles variables", type: "setVariable", variables: {} };
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Type d'étape de boucle non supporté: ${String(exhaustiveCheck)}`);
    }
  }
}
