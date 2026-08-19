import type { ActionNode, ExtractionRule } from "@datarover/workflow-types";
import { HttpNodeInspector } from "./inspectors/HttpNodeInspector";
import { ExtractNodeInspector } from "./inspectors/ExtractNodeInspector";
import { ConditionNodeInspector } from "./inspectors/ConditionNodeInspector";
import { SetVariableNodeInspector } from "./inspectors/SetVariableNodeInspector";
import { StopNodeInspector } from "./inspectors/StopNodeInspector";
import { DataTransformNodeInspector } from "./inspectors/DataTransformNodeInspector";
import { TextCryptoNodeInspector } from "./inspectors/TextCryptoNodeInspector";
import { NODE_LABELS } from "../lib/nodeStyles";

export function NodeInspectorPanel({
  node,
  availableNodeIds,
  projectId,
  onChange,
  onClose,
  onCreateExtractNode,
}: {
  node: ActionNode | null;
  availableNodeIds: string[];
  /** Needed by HttpNodeInspector's preview & selection tool (Specs.md §6). */
  projectId: string;
  onChange: (updated: ActionNode) => void;
  onClose: () => void;
  /** Forwarded to HttpNodeInspector — see its own doc comment. */
  onCreateExtractNode: (rules: ExtractionRule[]) => void;
}): JSX.Element | null {
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
        return <SetVariableNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} />;
      case "stop":
        return <StopNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} />;
      case "dataTransform":
        return <DataTransformNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} />;
      case "textCrypto":
        return <TextCryptoNodeInspector key={currentNode.id} node={currentNode} onChange={onChange} />;
      default: {
        const exhaustiveCheck: never = currentNode;
        throw new Error(`Type de node non supporté: ${String((exhaustiveCheck as ActionNode).type)}`);
      }
    }
  }

  return (
    <aside className="flex h-full w-80 flex-shrink-0 flex-col border-l border-gray-200 bg-white">
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
      <div className="flex-1 overflow-y-auto px-4 py-4">{renderInspector()}</div>
    </aside>
  );
}
