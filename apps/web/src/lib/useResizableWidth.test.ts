import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useResizableWidth } from "./useResizableWidth";

const STORAGE_KEY = "test.panel.width";

/**
 * jsdom's `PointerEvent` constructor support is inconsistent across versions — since the hook
 * under test only ever reads `event.clientX`, a plain `Event` of the right type with `clientX`
 * attached is a faithful enough stand-in without depending on that constructor at all.
 */
function firePointerMove(clientX: number): void {
  const event = new Event("pointermove") as unknown as PointerEvent;
  Object.defineProperty(event, "clientX", { value: clientX, configurable: true });
  window.dispatchEvent(event);
}

function firePointerUp(): void {
  window.dispatchEvent(new Event("pointerup"));
}

function startDrag(handlePointerDown: (event: React.PointerEvent) => void, clientX: number): void {
  handlePointerDown({ clientX } as unknown as React.PointerEvent);
}

describe("useResizableWidth", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("starts at defaultWidth when nothing is stored", () => {
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720 }),
    );
    expect(result.current.width).toBe(320);
    expect(result.current.isResizing).toBe(false);
  });

  it("reads a previously persisted width for the given storageKey", () => {
    window.localStorage.setItem(STORAGE_KEY, "450");
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720, storageKey: STORAGE_KEY }),
    );
    expect(result.current.width).toBe(450);
  });

  it("clamps a stored width that is outside the min/max range", () => {
    window.localStorage.setItem(STORAGE_KEY, "5000");
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720, storageKey: STORAGE_KEY }),
    );
    expect(result.current.width).toBe(720);
  });

  it("falls back to defaultWidth when the stored value is not a number", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-number");
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720, storageKey: STORAGE_KEY }),
    );
    expect(result.current.width).toBe(320);
  });

  it("widens the panel when the handle is dragged left (the handle sits on the left edge)", () => {
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720 }),
    );

    act(() => startDrag(result.current.handlePointerDown, 500));
    expect(result.current.isResizing).toBe(true);

    act(() => firePointerMove(440)); // moved 60px left
    expect(result.current.width).toBe(380);

    act(() => firePointerUp());
    expect(result.current.isResizing).toBe(false);
  });

  it("narrows the panel when the handle is dragged right", () => {
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720 }),
    );

    act(() => startDrag(result.current.handlePointerDown, 500));
    act(() => firePointerMove(540)); // moved 40px right
    expect(result.current.width).toBe(280);
  });

  it("clamps the width to minWidth/maxWidth while dragging past either bound", () => {
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720 }),
    );

    act(() => startDrag(result.current.handlePointerDown, 500));
    act(() => firePointerMove(1500)); // far past minWidth on the right
    expect(result.current.width).toBe(280);

    act(() => firePointerMove(-2000)); // far past maxWidth on the left
    expect(result.current.width).toBe(720);
  });

  it("persists the final width to localStorage only once the drag ends, not on every move", () => {
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720, storageKey: STORAGE_KEY }),
    );

    act(() => startDrag(result.current.handlePointerDown, 500));
    act(() => firePointerMove(440));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => firePointerUp());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("380");
  });

  it("does not react to pointer movement once the drag has ended", () => {
    const { result } = renderHook(() =>
      useResizableWidth({ defaultWidth: 320, minWidth: 280, maxWidth: 720 }),
    );

    act(() => startDrag(result.current.handlePointerDown, 500));
    act(() => firePointerMove(440));
    act(() => firePointerUp());
    const widthAfterDrag = result.current.width;

    act(() => firePointerMove(200));
    expect(result.current.width).toBe(widthAfterDrag);
  });
});
