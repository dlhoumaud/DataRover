import { useLayoutEffect, useRef, useState } from "react";

/**
 * React Flow has no built-in context menu — this is our own, positioned at the cursor via
 * `onNodeContextMenu` (see WorkflowEditorPage), closed on an outside click, Escape, or after an
 * action runs.
 */
export interface NodeContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

/** Keeps the menu fully on screen even when the triggering click is near an edge — the editor
 *  page has no page-level scroll (it fills the window), so a menu that rendered off-screen would
 *  be entirely unreachable rather than merely requiring a scroll. */
const VIEWPORT_MARGIN = 4;

export function NodeContextMenu({
  state,
  onDuplicate,
  onDelete,
  onClose,
}: {
  state: NodeContextMenuState;
  onDuplicate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: state.y, left: state.x });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const { offsetWidth, offsetHeight } = menu;
    const top = Math.min(state.y, window.innerHeight - offsetHeight - VIEWPORT_MARGIN);
    const left = Math.min(state.x, window.innerWidth - offsetWidth - VIEWPORT_MARGIN);
    setPosition({ top: Math.max(VIEWPORT_MARGIN, top), left: Math.max(VIEWPORT_MARGIN, left) });
  }, [state.x, state.y]);

  useLayoutEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      data-node-id={state.nodeId}
      style={{ position: "fixed", top: position.top, left: position.left }}
      className="z-50 w-40 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onDuplicate(state.nodeId);
          onClose();
        }}
        className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100"
      >
        Dupliquer
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onDelete(state.nodeId);
          onClose();
        }}
        className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
      >
        Supprimer
      </button>
    </div>
  );
}
