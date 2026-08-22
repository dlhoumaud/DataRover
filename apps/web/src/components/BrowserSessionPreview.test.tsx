import { StrictMode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BrowserSessionPreview } from "./BrowserSessionPreview";

/**
 * A controllable stand-in for the real `WebSocket` global — this component's whole job is
 * translating a `{{ }}`-free wire protocol into UI state and back, which is exactly as testable
 * without a real socket/server as with one; the real connection (and the real browser-worker
 * behind it) is already covered end to end by
 * `apps/browser-worker/test/session-live.e2e.test.ts` and `apps/api/test/session-live.e2e.test.ts`.
 */
class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.dispatch("close", {});
  }

  dispatch(type: string, event: unknown): void {
    for (const handler of this.listeners[type] ?? []) {
      handler(event);
    }
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  receive(message: unknown): void {
    this.dispatch("message", { data: JSON.stringify(message) });
  }
}

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) {
    throw new Error("No FakeWebSocket instance was created");
  }
  return socket;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

describe("BrowserSessionPreview", () => {
  it("sends 'start' with the given startUrl as soon as the socket opens", async () => {
    render(<BrowserSessionPreview startUrl="https://example.com/login" onClose={vi.fn()} onValidate={vi.fn()} />);
    const socket = latestSocket();
    socket.open();

    await waitFor(() => {
      expect(socket.sent).toContain(JSON.stringify({ type: "start", startUrl: "https://example.com/login" }));
    });
  });

  it("accumulates recorded actions as they arrive and shows them in the list", async () => {
    render(<BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />);
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });

    socket.receive({ type: "action", step: { type: "click", selector: "#submit" } });
    socket.receive({ type: "action", step: { type: "type", selector: "#q", text: "hello" } });

    await waitFor(() => {
      expect(screen.getByText("Valider (2 actions)")).toBeInTheDocument();
    });
  });

  it("toggles recording by sending startRecording/stopRecording", async () => {
    render(<BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />);
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });

    fireEvent.click(await screen.findByText("Enregistrer"));
    await waitFor(() => expect(socket.sent).toContain(JSON.stringify({ type: "startRecording" })));

    fireEvent.click(screen.getByText("● Arrêter l'enregistrement"));
    await waitFor(() => expect(socket.sent).toContain(JSON.stringify({ type: "stopRecording" })));
  });

  it("hands every accumulated step to onValidate, then closes, when 'Valider' is clicked", async () => {
    const onValidate = vi.fn();
    const onClose = vi.fn();
    render(<BrowserSessionPreview startUrl="https://example.com" onClose={onClose} onValidate={onValidate} />);
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });
    socket.receive({ type: "action", step: { type: "click", selector: "#submit" } });

    fireEvent.click(await screen.findByText("Valider (1 action)"));

    expect(onValidate).toHaveBeenCalledWith([{ type: "click", selector: "#submit" }]);
    expect(onClose).toHaveBeenCalled();
  });

  it("removing an accumulated step before validating leaves it out", async () => {
    const onValidate = vi.fn();
    render(<BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={onValidate} />);
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });
    socket.receive({ type: "action", step: { type: "click", selector: "#a" } });
    socket.receive({ type: "action", step: { type: "click", selector: "#b" } });

    const removeButtons = await screen.findAllByText("supprimer");
    fireEvent.click(removeButtons[0]!);

    fireEvent.click(await screen.findByText("Valider (1 action)"));
    expect(onValidate).toHaveBeenCalledWith([{ type: "click", selector: "#b" }]);
  });

  it("focuses the canvas on mousedown, so keyboard focus never silently stays on the underlying editor node", async () => {
    const { container } = render(
      <BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />,
    );
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected a <canvas> to be rendered once the session is ready");
    }
    expect(document.activeElement).not.toBe(canvas);
    fireEvent.mouseDown(canvas);
    expect(document.activeElement).toBe(canvas);
  });

  it("stops a keydown on the canvas from bubbling to the editor underneath (e.g. React Flow's own 'Backspace deletes the selected node' shortcut)", async () => {
    const outerKeyDown = vi.fn();
    // A real, native, bubbling listener on an ancestor — reproducing exactly the kind of global
    // shortcut this needs to be shielded from, whether it's wired through React or `addEventListener`.
    document.addEventListener("keydown", outerKeyDown);
    try {
      const { container } = render(
        <BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />,
      );
      const socket = latestSocket();
      socket.open();
      socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });

      const canvas = container.querySelector("canvas");
      if (!canvas) {
        throw new Error("Expected a <canvas> to be rendered once the session is ready");
      }
      fireEvent.keyDown(canvas, { key: "Backspace" });

      expect(outerKeyDown).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(socket.sent).toContain(JSON.stringify({ type: "keyDown", key: "Backspace" }));
      });
    } finally {
      document.removeEventListener("keydown", outerKeyDown);
    }
  });

  it("shows the server's error message instead of the canvas", async () => {
    render(<BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />);
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "error", message: "Target resolves to a private address" });

    expect(await screen.findByText("Target resolves to a private address")).toBeInTheDocument();
  });

  it("forwards a wheel event on the canvas as a 'wheel' message, so the remote page can be scrolled", async () => {
    const { container } = render(
      <BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />,
    );
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected a <canvas> to be rendered once the session is ready");
    }
    fireEvent.wheel(canvas, { deltaX: 0, deltaY: 120 });

    await waitFor(() => {
      expect(socket.sent).toContain(JSON.stringify({ type: "wheel", deltaX: 0, deltaY: 120 }));
    });
  });

  it("ignores a late error/close from a socket already discarded by a React.StrictMode double-mount", async () => {
    // The app renders under React.StrictMode (main.tsx) — in dev, that mounts this effect, cleans
    // it up, then mounts it again immediately: the *first* socket's close() (from that cleanup)
    // can still fire an `error`/`close` event asynchronously afterwards, on a browser's own
    // schedule, well after the *second* (real, surviving) socket has already connected fine.
    // Reproduces the exact bug reported against the live app: a stray event from that discarded
    // first socket used to set `errorMessage` regardless, permanently hiding the working preview.
    render(
      <StrictMode>
        <BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />
      </StrictMode>,
    );
    expect(FakeWebSocket.instances.length).toBe(2);
    const [discarded, live] = FakeWebSocket.instances as [FakeWebSocket, FakeWebSocket];

    live.open();
    live.receive({ type: "ready", viewport: { width: 1280, height: 720 } });
    await screen.findByRole("button", { name: "Enregistrer" });

    discarded.dispatch("error", {});

    expect(screen.queryByText("Connexion perdue avec le service de navigation.")).not.toBeInTheDocument();
  });

  it("shows a replace banner and relabels 'Valider' as 'Remplacer' when replaceLabel is set", async () => {
    const onValidate = vi.fn();
    render(
      <BrowserSessionPreview
        startUrl="https://example.com"
        onClose={vi.fn()}
        onValidate={onValidate}
        replaceLabel="Survoler — .full-width"
      />,
    );
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });
    socket.receive({ type: "action", step: { type: "hover", selector: "#unique" } });

    expect(await screen.findByText("Survoler — .full-width")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Remplacer (1 action)"));
    expect(onValidate).toHaveBeenCalledWith([{ type: "hover", selector: "#unique" }]);
  });

  it("shows 'Valider', with no replace banner, when replaceLabel is omitted", async () => {
    render(<BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />);
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: "ready", viewport: { width: 1280, height: 720 } });
    socket.receive({ type: "action", step: { type: "click", selector: "#a" } });

    expect(await screen.findByText("Valider (1 action)")).toBeInTheDocument();
    expect(screen.queryByText(/Remplace/)).not.toBeInTheDocument();
  });

  it("closes its socket on unmount", () => {
    const { unmount } = render(
      <BrowserSessionPreview startUrl="https://example.com" onClose={vi.fn()} onValidate={vi.fn()} />,
    );
    const socket = latestSocket();
    unmount();
    expect(socket.readyState).toBe(3);
  });
});
