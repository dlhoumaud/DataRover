import { create } from "zustand";

export interface EditorState {
  selectedNodeId: string | null;
  isDirty: boolean;
  selectNode: (id: string | null) => void;
  markDirty: () => void;
  markClean: () => void;
}

/**
 * Deliberately minimal: this app only ever has a single workflow editor
 * open at a time, so a single global store is enough. No persistence and
 * no undo/redo history in this iteration.
 */
export const useEditorStore = create<EditorState>((set) => ({
  selectedNodeId: null,
  isDirty: false,
  selectNode: (id) => set({ selectedNodeId: id }),
  markDirty: () => set({ isDirty: true }),
  markClean: () => set({ isDirty: false, selectedNodeId: null }),
}));
