import type { ActionNode } from "@datarover/workflow-types";
import { NODE_COLORS } from "../lib/nodeStyles";

const NODE_TYPE_BUTTONS: ReadonlyArray<{ type: ActionNode["type"]; label: string }> = [
  { type: "http", label: "HTTP" },
  { type: "browserAction", label: "Navigateur" },
  { type: "extract", label: "Extraction" },
  { type: "condition", label: "Condition" },
  { type: "loop", label: "Boucle" },
  { type: "setVariable", label: "Variables" },
  { type: "dataTransform", label: "Traitement" },
  { type: "textCrypto", label: "Crypto / Encodage" },
  { type: "stop", label: "Stop" },
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
          className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-100"
        >
          <span
            className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${NODE_COLORS[button.type]}`}
            aria-hidden="true"
          />
          {button.label}
        </button>
      ))}
    </div>
  );
}
