import type { ActionNode } from "@datarover/workflow-types";

const NODE_TYPE_BUTTONS: ReadonlyArray<{ type: ActionNode["type"]; label: string }> = [
  { type: "http", label: "+ HTTP" },
  { type: "extract", label: "+ Extraction" },
  { type: "condition", label: "+ Condition" },
  { type: "setVariable", label: "+ Variables" },
  { type: "stop", label: "+ Stop" },
];

export function NodePalette({
  onAddNode,
}: {
  onAddNode: (type: ActionNode["type"]) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2">
      {NODE_TYPE_BUTTONS.map((button) => (
        <button
          key={button.type}
          type="button"
          onClick={() => onAddNode(button.type)}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-100"
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
