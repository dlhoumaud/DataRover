import { useState } from "react";
import type { ActionNode, ExtractionRule, ExtractSourceType } from "@datarover/workflow-types";
import { HttpNodeInspector } from "./inspectors/HttpNodeInspector";
import { ExtractNodeInspector } from "./inspectors/ExtractNodeInspector";
import { ConditionNodeInspector } from "./inspectors/ConditionNodeInspector";
import { SetVariableNodeInspector } from "./inspectors/SetVariableNodeInspector";
import { StopNodeInspector } from "./inspectors/StopNodeInspector";
import { DataTransformNodeInspector } from "./inspectors/DataTransformNodeInspector";
import { TextCryptoNodeInspector } from "./inspectors/TextCryptoNodeInspector";
import { LoopNodeInspector } from "./inspectors/LoopNodeInspector";
import { BrowserActionNodeInspector } from "./inspectors/BrowserActionNodeInspector";
import { NODE_LABELS } from "../lib/nodeStyles";
import { useResizableWidth } from "../lib/useResizableWidth";
import { getNodeOutputVariables, type TemplateVariable } from "../lib/templateVariables";

/**
 * Every `{{ }}`-usable reference the currently-open node contributes once it has run (see
 * `getNodeOutputVariables`'s own doc comment for exactly what's known per node type) — shown here,
 * once, for every node type, rather than duplicated inside each individual inspector, so a node
 * connected downstream of this one can be configured to reference it correctly without needing to
 * remember/guess this node's id or output shape. Click any entry to copy its `{{ }}` form.
 */
function NodeOutputVariables({ node }: { node: ActionNode }): JSX.Element {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const variables = getNodeOutputVariables(node);

  function handleCopy(path: string): void {
    navigator.clipboard
      .writeText(`{{ ${path} }}`)
      .then(() => {
        setCopiedPath(path);
        setTimeout(() => setCopiedPath((current) => (current === path ? null : current)), 1500);
      })
      .catch(() => undefined);
  }

  return (
    <div className="border-b border-gray-200 px-4 py-2">
      <p className="text-xs font-medium text-gray-500">
        {variables.length > 1 ? "Variables de sortie" : "Variable de sortie"}
      </p>
      <ul className="mt-1 space-y-0.5">
        {variables.map((variable) => (
          <li key={variable.path}>
            <button
              type="button"
              onClick={() => handleCopy(variable.path)}
              title="Copier la référence {{ }}"
              className="flex w-full items-center justify-between rounded px-1 py-0.5 text-left font-mono text-xs text-gray-600 hover:bg-gray-50"
            >
              <span className="truncate">{`{{ ${variable.path} }}`}</span>
              <span className="ml-2 flex-shrink-0 text-gray-400">
                {copiedPath === variable.path ? "Copié !" : "copier"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DEFAULT_WIDTH = 320; // matches the previous fixed `w-80`
const MIN_WIDTH = 280;
const MAX_WIDTH = 720; // generous enough for the Loop node's nested body-step editor
const WIDTH_STORAGE_KEY = "datarover.nodeInspectorPanel.width";

export function NodeInspectorPanel({
  node,
  availableNodeIds,
  variables,
  projectId,
  onChange,
  onClose,
  onCreateExtractNode,
}: {
  node: ActionNode | null;
  availableNodeIds: string[];
  /** Every `{{ }}`-usable variable currently available to this node — see
   *  `lib/templateVariables.ts`'s `getAvailableVariables`. Forwarded to every inspector whose
   *  fields accept a `{{ }}` template, for `TemplateInput`'s autocomplete. */
  variables: TemplateVariable[];
  /** Needed by HttpNodeInspector's preview & selection tool (Specs.md §6). */
  projectId: string;
  onChange: (updated: ActionNode) => void;
  onClose: () => void;
  /** Forwarded to HttpNodeInspector — see its own doc comment. */
  onCreateExtractNode: (rules: ExtractionRule[], sourceType: ExtractSourceType) => void;
}): JSX.Element | null {
  // Called unconditionally, before the `node === null` early return below, per the Rules of
  // Hooks — the width itself is happily kept (and still persisted) across the panel being
  // closed/reopened for a different node, which is the whole point of persisting it.
  const { width, isResizing, handlePointerDown } = useResizableWidth({
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    storageKey: WIDTH_STORAGE_KEY,
  });

  if (node === null) {
    return null;
  }

  // Captured as a `const` (rather than relying on narrowing of the `node`
  // parameter across the nested `renderInspector` closure below) so the
  // discriminated-union narrowing from the guard above is unambiguous.
  const currentNode = node;

  function renderInspector(): JSX.Element {
    switch (currentNode.type) {
      case "http":
        return (
          <HttpNodeInspector
            key={currentNode.id}
            node={currentNode}
            onChange={onChange}
            projectId={projectId}
            onCreateExtractNode={onCreateExtractNode}
            variables={variables}
          />
        );
      case "extract":
        return (
          <ExtractNodeInspector
            key={currentNode.id}
            node={currentNode}
            availableNodeIds={availableNodeIds}
            onChange={onChange}
          />
        );
      case "condition":
        return <ConditionNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} />;
      case "setVariable":
        return (
          <SetVariableNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} variables={variables} />
        );
      case "stop":
        return <StopNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} />;
      case "dataTransform":
        return (
          <DataTransformNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} variables={variables} />
        );
      case "textCrypto":
        return (
          <TextCryptoNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} variables={variables} />
        );
      case "loop":
        return <LoopNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} variables={variables} />;
      case "browserAction":
        return (
          <BrowserActionNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} variables={variables} />
        );
      default: {
        const exhaustiveCheck: never = currentNode;
        throw new Error(`Type de node non supporté: ${String((exhaustiveCheck as ActionNode).type)}`);
      }
    }
  }

  return (
    <aside
      style={{ width }}
      className="relative flex h-full flex-shrink-0 flex-col border-l border-gray-200 bg-white"
    >
      {/* Drag handle: a thin strip straddling the panel's left border, widened on hover/drag so
          it's easy to grab without stealing width from the panel's own content at rest. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner le panneau"
        onPointerDown={handlePointerDown}
        className={`absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none select-none hover:bg-indigo-400/70 ${
          isResizing ? "bg-indigo-500" : "bg-transparent"
        }`}
      />
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="truncate text-sm font-semibold text-gray-900">{currentNode.name}</h2>
          <p className="text-xs uppercase tracking-wide text-gray-400">{NODE_LABELS[currentNode.type]}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          Fermer
        </button>
      </div>
      <NodeOutputVariables node={currentNode} />
      <div className="flex-1 overflow-y-auto px-4 py-4">{renderInspector()}</div>
    </aside>
  );
}
