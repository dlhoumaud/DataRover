import { create } from "zustand";

export interface EditorState {
  selectedNodeId: string | null;
  isDirty: boolean;
  /**
   * Id of the node the workflow starts execution from — mirrors
   * `WorkflowDefinition.startNodeId`, but lives here (rather than as a plain `useState` in
   * `WorkflowEditorPage`) so `WorkflowNode` can read it directly to render its "Départ" badge,
   * the same way it already reads `selectedNodeId` indirectly via React Flow's own selection.
   * `null` only in the (schema-invalid, unsaveable) transient state right after deleting a
   * workflow's very last node — see `reassignStartNodeId` in `lib/workflowGraph.ts`.
   */
  startNodeId: string | null;
  selectNode: (id: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
  setStartNodeId: (id: string | null) => void;
}

/**
 * Deliberately minimal: this app only ever has a single workflow editor
 * open at a time, so a single global store is enough. No persistence and
 * no undo/redo history in this iteration.
 */
export const useEditorStore = create<EditorState>((set) => ({
  selectedNodeId: null,
  isDirty: false,
  startNodeId: null,
  selectNode: (id) => set({ selectedNodeId: id }),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false, selectedNodeId: null }),
  setStartNodeId: (id) => set({ startNodeId: id }),
}));
