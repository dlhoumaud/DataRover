import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { BrowserActionNode } from "@datarover/workflow-types";
import { BrowserActionNodeInspector } from "./BrowserActionNodeInspector";

/** Same fake used by BrowserSessionPreview.test.tsx — the live-preview modal it drives is
 *  already thoroughly tested on its own there; the one thing worth covering *here* is that a
 *  validated recording actually lands in this node's own `steps`, not the preview UI itself. */
class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  send(): void {
    // Not asserted on here — BrowserSessionPreview.test.tsx already covers what gets sent.
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  receive(message: unknown): void {
    this.dispatch("message", { data: JSON.stringify(message) });
  }

  private dispatch(type: string, event: unknown): void {
    for (const handler of this.listeners[type] ?? []) {
      handler(event);
    }
  }
}

/** `Array.prototype.at`-style indexing, but throwing instead of returning `undefined` — the
 *  project's `noUncheckedIndexedAccess` tsconfig option means a plain `items[index]` (or
 *  destructuring) types as possibly-`undefined`, which `fireEvent.change` won't accept; a missing
 *  element here is a genuine test bug worth failing loudly on, not a case to silently tolerate. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected an element at index ${index}, only found ${items.length}`);
  }
  return item;
}

/** Mirrors workflowGraph.ts's createDefaultNode("browserAction", ...) — see its own doc comment
 *  on why the default step is `wait`, not `click`. */
function defaultNode(overrides?: Partial<BrowserActionNode>): BrowserActionNode {
  return {
    id: "ba1",
    name: "New Navigateur",
    type: "browserAction",
    startUrl: "",
    steps: [{ type: "wait", ms: 500 }],
    timeoutMs: 30_000,
    ...overrides,
  };
}

describe("BrowserActionNodeInspector", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  it("commits a startUrl edit once every step already parses (regression: a freshly-created node used to never save anything)", async () => {
    const onChange = vi.fn();
    render(<BrowserActionNodeInspector node={defaultNode()} onChange={onChange} />);

    fireEvent.change(screen.getByPlaceholderText("{{ global.baseUrl }}/login"), {
      target: { value: "https://example.com/login" },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
    expect(updated.startUrl).toBe("https://example.com/login");
    expect(updated.steps).toEqual([{ type: "wait", ms: 500 }]);
  });

  it("never commits (not even startUrl) while a step is genuinely incomplete — documents the all-or-nothing save gate this shares with TextCryptoNodeInspector", async () => {
    const onChange = vi.fn();
    // A `click` step with no selector yet — schema-invalid until the user fills it in.
    render(
      <BrowserActionNodeInspector node={defaultNode({ steps: [{ type: "click", selector: "" }] })} onChange={onChange} />,
    );

    fireEvent.change(screen.getByPlaceholderText("{{ global.baseUrl }}/login"), {
      target: { value: "https://example.com/login" },
    });

    // No `waitFor(() => expect(...).toHaveBeenCalled())` here on purpose: this asserts the
    // *absence* of a call, so it has to actually wait out a window rather than resolve the
    // instant a (nonexistent) call happens.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits once the incomplete step is filled in", async () => {
    const onChange = vi.fn();
    render(
      <BrowserActionNodeInspector node={defaultNode({ steps: [{ type: "click", selector: "" }] })} onChange={onChange} />,
    );

    fireEvent.change(screen.getByPlaceholderText("#selecteur, .classe, …"), {
      target: { value: "#submit" },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
    expect(updated.steps).toEqual([{ type: "click", selector: "#submit" }]);
  });

  it("appends an already-valid step via '+ ajouter une action', with no further edits required to save", async () => {
    const onChange = vi.fn();
    render(<BrowserActionNodeInspector node={defaultNode()} onChange={onChange} />);

    fireEvent.click(screen.getByText("+ ajouter une action"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
    expect(updated.steps).toEqual([
      { type: "wait", ms: 500 },
      { type: "wait", ms: 500 },
    ]);
  });

  it("commits a moveMouse step, then a fixed delay, then a random delay, as each is filled in", async () => {
    const onChange = vi.fn();
    render(<BrowserActionNodeInspector node={defaultNode()} onChange={onChange} />);

    const stepTypeSelect = nth(screen.getAllByRole("combobox"), 0);
    fireEvent.change(stepTypeSelect, { target: { value: "moveMouse" } });
    fireEvent.change(screen.getByPlaceholderText("x"), { target: { value: "120" } });
    fireEvent.change(screen.getByPlaceholderText("y"), { target: { value: "340" } });

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([{ type: "moveMouse", x: 120, y: 340 }]);
    });

    const delaySelect = nth(screen.getAllByRole("combobox"), 1);
    fireEvent.change(delaySelect, { target: { value: "fixed" } });
    fireEvent.change(screen.getByPlaceholderText("Délai (ms)"), { target: { value: "80" } });

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([{ type: "moveMouse", x: 120, y: 340, delay: { kind: "fixed", ms: 80 } }]);
    });

    fireEvent.change(delaySelect, { target: { value: "random" } });
    fireEvent.change(screen.getByPlaceholderText("Min (ms)"), { target: { value: "20" } });
    fireEvent.change(screen.getByPlaceholderText("Max (ms)"), { target: { value: "90" } });

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([
        { type: "moveMouse", x: 120, y: 340, delay: { kind: "random", minMs: 20, maxMs: 90 } },
      ]);
    });
  });

  it("commits a moveMouseRandom step with a random delay", async () => {
    const onChange = vi.fn();
    render(<BrowserActionNodeInspector node={defaultNode()} onChange={onChange} />);

    const stepTypeSelect = nth(screen.getAllByRole("combobox"), 0);
    fireEvent.change(stepTypeSelect, { target: { value: "moveMouseRandom" } });

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([{ type: "moveMouseRandom" }]);
    });

    const delaySelect = nth(screen.getAllByRole("combobox"), 1);
    fireEvent.change(delaySelect, { target: { value: "random" } });
    fireEvent.change(screen.getByPlaceholderText("Min (ms)"), { target: { value: "10" } });
    fireEvent.change(screen.getByPlaceholderText("Max (ms)"), { target: { value: "50" } });

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([{ type: "moveMouseRandom", delay: { kind: "random", minMs: 10, maxMs: 50 } }]);
    });
  });

  it("commits a type step's random per-keystroke delay", async () => {
    const onChange = vi.fn();
    const node = defaultNode({ steps: [{ type: "type", selector: "#q", text: "hello" }] });
    render(<BrowserActionNodeInspector node={node} onChange={onChange} />);

    const delaySelect = nth(screen.getAllByRole("combobox"), 1);
    fireEvent.change(delaySelect, { target: { value: "random" } });
    fireEvent.change(screen.getByPlaceholderText("Min (ms)"), { target: { value: "30" } });
    fireEvent.change(screen.getByPlaceholderText("Max (ms)"), { target: { value: "120" } });

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([
        { type: "type", selector: "#q", text: "hello", delay: { kind: "random", minMs: 30, maxMs: 120 } },
      ]);
    });
  });

  it("does not commit a random delay whose max is less than its min", async () => {
    const onChange = vi.fn();
    const node = defaultNode({ steps: [{ type: "type", selector: "#q", text: "hello" }] });
    render(<BrowserActionNodeInspector node={node} onChange={onChange} />);

    const delaySelect = nth(screen.getAllByRole("combobox"), 1);
    fireEvent.change(delaySelect, { target: { value: "random" } });
    fireEvent.change(screen.getByPlaceholderText("Min (ms)"), { target: { value: "100" } });
    fireEvent.change(screen.getByPlaceholderText("Max (ms)"), { target: { value: "10" } });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onChange).not.toHaveBeenCalled();
  });

  // Exhaustive sweep — one case per step type, switching the default "wait" step to it and
  // filling in exactly its required fields, then asserting the commit actually happens. Written
  // to pin down a user report of "certaines actions" not saving without knowing in advance which
  // ones; every type from the palette is exercised once, rather than trusting a read-through of
  // formValuesToStep/stepToFormValues to have caught every case.
  it.each<{ type: string; fill: () => void; expected: unknown }>([
    {
      type: "navigate",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("{{ global.baseUrl }}/page-suivante"), {
          target: { value: "https://example.com/next" },
        });
      },
      expected: { type: "navigate", url: "https://example.com/next" },
    },
    {
      type: "click",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("#selecteur, .classe, …"), {
          target: { value: "#go" },
        });
      },
      expected: { type: "click", selector: "#go" },
    },
    {
      type: "press",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("Enter, Tab, Escape, …"), {
          target: { value: "Enter" },
        });
      },
      expected: { type: "press", key: "Enter" },
    },
    {
      type: "select",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("#selecteur, .classe, …"), {
          target: { value: "#country" },
        });
        fireEvent.change(screen.getByPlaceholderText("Valeur à sélectionner"), {
          target: { value: "FR" },
        });
      },
      expected: { type: "select", selector: "#country", value: "FR" },
    },
    {
      type: "hover",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("#selecteur, .classe, …"), {
          target: { value: ".menu" },
        });
      },
      expected: { type: "hover", selector: ".menu" },
    },
    {
      type: "dragTo",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("Sélecteur source"), { target: { value: "#item" } });
        fireEvent.change(screen.getByPlaceholderText("Sélecteur cible"), { target: { value: "#bin" } });
      },
      expected: { type: "dragTo", sourceSelector: "#item", targetSelector: "#bin" },
    },
    {
      type: "scrollIntoView",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("#selecteur, .classe, …"), {
          target: { value: "#footer" },
        });
      },
      expected: { type: "scrollIntoView", selector: "#footer" },
    },
    {
      type: "scrollPage",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("y"), { target: { value: "400" } });
      },
      expected: { type: "scrollPage", x: 0, y: 400 },
    },
    {
      type: "wait",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("Durée (ms)"), { target: { value: "250" } });
      },
      expected: { type: "wait", ms: 250 },
    },
    {
      type: "waitForSelector",
      fill: () => {
        fireEvent.change(screen.getByPlaceholderText("#selecteur, .classe, …"), {
          target: { value: "#result" },
        });
      },
      expected: { type: "waitForSelector", selector: "#result" },
    },
  ])("commits a fully-filled-in $type step", async ({ type, fill, expected }) => {
    const onChange = vi.fn();
    render(<BrowserActionNodeInspector node={defaultNode()} onChange={onChange} />);

    fireEvent.change(nth(screen.getAllByRole("combobox"), 0), { target: { value: type } });
    fill();

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([expected]);
    });
  });

  it("configures three appended actions of different types in sequence, without earlier ones getting corrupted", async () => {
    const onChange = vi.fn();
    render(<BrowserActionNodeInspector node={defaultNode()} onChange={onChange} />);

    // Row 0: leave as the default "wait" — already valid (ms: 500).
    // Row 1: append (defaults to "wait" too), switch to "click", fill its selector.
    fireEvent.click(screen.getByText("+ ajouter une action"));
    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toHaveLength(2);
    });
    fireEvent.change(nth(screen.getAllByRole("combobox"), 1), { target: { value: "click" } });
    fireEvent.change(screen.getByPlaceholderText("#selecteur, .classe, …"), { target: { value: "#step2" } });
    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([
        { type: "wait", ms: 500 },
        { type: "click", selector: "#step2" },
      ]);
    });

    // Row 2: append again, switch to "dragTo" (two required fields), fill only the first —
    // the whole node must still reflect rows 0/1 unchanged while row 2 stays incomplete.
    fireEvent.click(screen.getByText("+ ajouter une action"));
    const callsBeforeRow3 = onChange.mock.calls.length;
    fireEvent.change(nth(screen.getAllByRole("combobox"), 2), { target: { value: "dragTo" } });
    fireEvent.change(screen.getByPlaceholderText("Sélecteur source"), { target: { value: "#a" } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Still incomplete (targetSelector empty) — no new commit beyond appending row 2 itself.
    expect(onChange.mock.calls.length).toBe(callsBeforeRow3);

    // Finishing row 2 commits the full, correct three-step sequence.
    fireEvent.change(screen.getByPlaceholderText("Sélecteur cible"), { target: { value: "#b" } });
    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([
        { type: "wait", ms: 500 },
        { type: "click", selector: "#step2" },
        { type: "dragTo", sourceSelector: "#a", targetSelector: "#b" },
      ]);
    });
  });

  it("appends every action validated from the live preview to the node's own steps", async () => {
    const onChange = vi.fn();
    render(
      <BrowserActionNodeInspector
        node={defaultNode({ startUrl: "https://example.com/login" })}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("Aperçu en direct & enregistrement d'actions"));
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) {
      throw new Error("BrowserSessionPreview did not open a WebSocket");
    }
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });
    socket.receive({ type: "action", step: { type: "click", selector: "#submit" } });

    fireEvent.click(await screen.findByText("Valider (1 action)"));

    await waitFor(() => {
      const latest = onChange.mock.calls.at(-1)?.[0] as BrowserActionNode;
      expect(latest.steps).toEqual([
        { type: "wait", ms: 500 }, // defaultNode()'s own initial step, untouched
        { type: "click", selector: "#submit" },
      ]);
    });
  });
});
