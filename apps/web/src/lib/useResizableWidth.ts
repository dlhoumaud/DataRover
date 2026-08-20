import { useCallback, useEffect, useRef, useState } from "react";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Reads a persisted width, tolerating a missing/corrupt/unavailable localStorage entry. */
function readStoredWidth(storageKey: string | undefined, min: number, max: number): number | undefined {
  if (!storageKey) {
    return undefined;
  }
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === null) {
      return undefined;
    }
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : undefined;
  } catch {
    // Private-browsing / storage-disabled edge case — fall back to the default width.
    return undefined;
  }
}

/**
 * Drag-to-resize width for a side panel whose handle sits on its **left** edge (dragging the
 * handle left widens the panel, right narrows it — the panel itself is anchored to the right side
 * of the layout). Persists the chosen width to `localStorage` under `storageKey` (once per drag,
 * on release — not on every intermediate pixel, which would otherwise hammer `localStorage` while
 * dragging) so it survives a reload; omit `storageKey` for an ephemeral, session-only width.
 *
 * Returns the current `width` in pixels, whether a drag is currently in progress (`isResizing` —
 * useful for suppressing hover/transition styles that would otherwise fight the drag), and
 * `handlePointerDown` to wire onto the handle element's `onPointerDown`.
 */
export function useResizableWidth({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
}: {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  storageKey?: string;
}): {
  width: number;
  isResizing: boolean;
  handlePointerDown: (event: React.PointerEvent) => void;
} {
  const [width, setWidth] = useState<number>(
    () => readStoredWidth(storageKey, minWidth, maxWidth) ?? defaultWidth,
  );
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ pointerX: number; startWidth: number } | null>(null);
  const latestWidthRef = useRef(width);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      dragStartRef.current = { pointerX: event.clientX, startWidth: width };
      setIsResizing(true);
    },
    [width],
  );

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    function handlePointerMove(event: PointerEvent): void {
      const dragStart = dragStartRef.current;
      if (!dragStart) {
        return;
      }
      // The handle is on the panel's left edge and the panel is anchored to the right of the
      // layout, so moving the pointer left (a negative clientX delta) should *widen* it.
      const delta = dragStart.pointerX - event.clientX;
      const next = clamp(dragStart.startWidth + delta, minWidth, maxWidth);
      latestWidthRef.current = next;
      setWidth(next);
    }

    function handlePointerUp(): void {
      setIsResizing(false);
      dragStartRef.current = null;
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, String(latestWidthRef.current));
        } catch {
          // Storage unavailable — the width still applies for the rest of this session.
        }
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isResizing, minWidth, maxWidth, storageKey]);

  return { width, isResizing, handlePointerDown };
}
