import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "../../lib/workflowGraph";
import { useEditorStore } from "../../lib/editorStore";
import { NODE_COLORS, NODE_LABELS } from "../../lib/nodeStyles";

/**
 * Single generic React Flow node component reused for every action node
 * type (see `nodeTypes` below) — the visual variation (color dot, handle
 * layout) is driven entirely by `data.node.type`, never by which key of
 * `nodeTypes` React Flow happened to look up. Colors/labels live in
 * `lib/nodeStyles.ts`, shared with the node-creation palette.
 */

export function WorkflowNode({ id, data, selected }: NodeProps<FlowNode>): JSX.Element {
  const selectNode = useEditorStore((state) => state.selectNode);
  const { node } = data;

  return (
    <div
      onClick={() => selectNode(id)}
      className={`relative min-w-[180px] max-w-[240px] cursor-pointer rounded-lg border bg-white px-3 py-2 shadow-sm transition-shadow hover:shadow-md ${
        selected ? "border-indigo-500 ring-2 ring-indigo-400 ring-offset-1" : "border-gray-200"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-gray-400" />

      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${NODE_COLORS[node.type]}`}
          aria-hidden="true"
        />
        <span className="truncate text-sm font-medium text-gray-900">{node.name}</span>
      </div>
      <div className="mt-0.5 pl-4 text-xs uppercase tracking-wide text-gray-400">
        {NODE_LABELS[node.type]}
      </div>

      {node.type === "condition" ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            style={{ top: "35%" }}
            className="!h-2.5 !w-2.5 !bg-green-500"
          />
          <span
            className="pointer-events-none absolute right-[-16px] text-xs font-bold text-green-600"
            style={{ top: "calc(35% - 8px)" }}
            aria-hidden="true"
          >
            ✓
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            style={{ top: "65%" }}
            className="!h-2.5 !w-2.5 !bg-red-500"
          />
          <span
            className="pointer-events-none absolute right-[-16px] text-xs font-bold text-red-600"
            style={{ top: "calc(65% - 8px)" }}
            aria-hidden="true"
          >
            ✗
          </span>
        </>
      ) : (
        <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-gray-400" />
      )}
    </div>
  );
}

export const nodeTypes = {
  http: WorkflowNode,
  extract: WorkflowNode,
  condition: WorkflowNode,
  setVariable: WorkflowNode,
  stop: WorkflowNode,
  dataTransform: WorkflowNode,
  textCrypto: WorkflowNode,
};
