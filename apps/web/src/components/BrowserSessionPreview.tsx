import { useEffect, useRef, useState } from "react";
import type { BrowserActionStep } from "@datarover/workflow-types";
import { API_BASE_URL } from "../api/client";

const SESSION_LIVE_WS_URL = `${API_BASE_URL.replace(/^http/, "ws")}/tools/session-live`;

/** Mouse buttons this component ever forwards — anything else (e.g. a fourth/fifth "extra"
 *  mouse button) simply isn't replayable through `page.mouse`, so it's ignored. */
function mouseButtonName(button: number): "left" | "middle" | "right" | null {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return null;
}

type ServerMessage =
  | { type: "ready"; viewport: { width: number; height: number } | null }
  | { type: "frame"; data: string }
  | { type: "action"; step: BrowserActionStep }
  | { type: "error"; message: string };

function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/**
 * Live preview + action recorder for the `browserAction` node's "Navigateur" — connects to
 * `apps/api`'s `GET /tools/session-live` (itself proxying to `apps/browser-worker`'s own
 * `/session/live`, which never talks to the frontend directly — see that gateway's doc comment),
 * draws each CDP screencast frame onto a `<canvas>`, and forwards pointer/keyboard input back
 * over the same connection, coordinate-mapped from the canvas's on-screen size to the remote
 * page's real viewport.
 *
 * "Enregistrer" toggles the in-page recorder; every `{type: "action"}` message received while it's
 * on accumulates here, exactly like `PreviewSelector`'s own accumulate-then-"Terminer" pattern —
 * "Valider" hands the accumulated steps to the caller (`BrowserActionNodeInspector`), which by
 * default appends them to the node's own step list, once, rather than committing each one as it
 * arrives. This component has no opinion on append-vs-replace itself — see `replaceLabel` below.
 */
export function BrowserSessionPreview({
  startUrl,
  onClose,
  onValidate,
  replaceLabel,
}: {
  startUrl: string;
  onClose: () => void;
  onValidate: (steps: BrowserActionStep[]) => void;
  /** Set by `BrowserActionNodeInspector` when this preview was opened from a single existing
   *  step's own "réenregistrer" button rather than the node's general recording button — purely
   *  cosmetic here (a banner + relabelled "Valider" button so the user knows what will happen),
   *  the actual append-vs-splice-in-place decision lives entirely in the caller's `onValidate`. */
  replaceLabel?: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const frameImageRef = useRef<HTMLImageElement>(new Image());
  const viewportRef = useRef<{ width: number; height: number }>({ width: 1280, height: 720 });
  const isRecordingRef = useRef(false);

  const [status, setStatus] = useState<"connecting" | "ready" | "closed">("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [accumulatedSteps, setAccumulatedSteps] = useState<BrowserActionStep[]>([]);

  useEffect(() => {
    // React.StrictMode (enabled in main.tsx) mounts this effect, cleans it up, then mounts it
    // again immediately — so the *first* socket gets close()'d by cleanup before its handshake
    // has necessarily settled from the browser's point of view, which fires a spurious `error`/
    // `close` event on that discarded socket. `cancelled` (captured per effect invocation, not a
    // ref) tells that first instance's own listeners to stop touching state once its cleanup has
    // run, so the real, surviving second connection is never fought over by a dead one.
    let cancelled = false;
    const socket = new WebSocket(SESSION_LIVE_WS_URL);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (cancelled) return;
      socket.send(JSON.stringify({ type: "start", startUrl }));
    });

    socket.addEventListener("message", (event) => {
      if (cancelled) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!isServerMessage(parsed)) {
        return;
      }

      if (parsed.type === "ready") {
        if (parsed.viewport) {
          viewportRef.current = parsed.viewport;
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = parsed.viewport.width;
            canvas.height = parsed.viewport.height;
          }
        }
        setStatus("ready");
      } else if (parsed.type === "frame") {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) {
          return;
        }
        const image = frameImageRef.current;
        image.onload = () => {
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        };
        image.src = `data:image/jpeg;base64,${parsed.data}`;
      } else if (parsed.type === "action") {
        setAccumulatedSteps((current) => [...current, parsed.step]);
      } else if (parsed.type === "error") {
        setErrorMessage(parsed.message);
      }
    });

    socket.addEventListener("close", () => {
      if (cancelled) return;
      setStatus("closed");
    });
    socket.addEventListener("error", () => {
      if (cancelled) return;
      setErrorMessage("Connexion perdue avec le service de navigation.");
    });

    // Scrolling the remote page — attached natively, not via JSX's `onWheel`: React marks
    // wheel/touch listeners passive by default (matching the browser's own default, for scroll
    // performance), which silently no-ops `preventDefault()`. That's needed here, otherwise the
    // wheel event also scrolls this component's own (`overflow-auto`) preview pane instead of (or
    // as well as) the remote page canvas is displaying. Safe to read `canvasRef.current` here:
    // refs are already committed by the time effects run, and the canvas is unconditionally
    // rendered whenever this effect's own socket hasn't yet reported an error (see the JSX below).
    const canvas = canvasRef.current;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      send({ type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY });
    };
    canvas?.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      cancelled = true;
      canvas?.removeEventListener("wheel", handleWheel);
      socket.close();
    };
    // Deliberately only on mount/unmount — starting a second session from the same open preview
    // isn't supported; the user closes and reopens it instead (matches PreviewSelector's own
    // one-shot-per-open lifecycle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function send(message: Record<string, unknown>): void {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }

  /** Maps a pointer event's on-screen position to the remote page's real viewport coordinates,
   *  accounting for the canvas being displayed smaller/larger than its own internal resolution. */
  function toRemoteCoordinates(event: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function handleMouseMove(event: React.MouseEvent<HTMLCanvasElement>): void {
    const { x, y } = toRemoteCoordinates(event);
    send({ type: "mouseMove", x, y });
  }

  function handleMouseDown(event: React.MouseEvent<HTMLCanvasElement>): void {
    // Explicit, not relying on the browser's own click-to-focus default: Firefox (unlike
    // Chrome/Safari) doesn't reliably focus a `tabIndex`-only element like this canvas on click.
    // Without this, keyboard focus silently stays wherever it already was — typically the
    // workflow node this preview was opened from — so every keystroke, Backspace included, keeps
    // reaching the *editor* underneath instead of this canvas: typing is never forwarded/recorded
    // at all, and React Flow's own "Backspace deletes the selected node" shortcut fires instead.
    event.currentTarget.focus();
    const button = mouseButtonName(event.button);
    if (!button) {
      return;
    }
    const { x, y } = toRemoteCoordinates(event);
    send({ type: "mouseDown", x, y, button });
  }

  function handleMouseUp(event: React.MouseEvent<HTMLCanvasElement>): void {
    const button = mouseButtonName(event.button);
    if (!button) {
      return;
    }
    const { x, y } = toRemoteCoordinates(event);
    send({ type: "mouseUp", x, y, button });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    // `preventDefault()` alone only suppresses the browser's own default action for this event —
    // it does NOT stop the event from bubbling further up. Without `stopPropagation()` too, e.g.
    // "Backspace" still reaches React Flow's own global "delete the selected node" shortcut
    // (which never even required the node itself to keep DOM focus — just that a canvas isn't a
    // form field it recognizes as "currently typing"), deleting the very node this preview was
    // opened from instead of editing the remote page's text field.
    event.stopPropagation();
    send({ type: "keyDown", key: event.key });
  }

  function handleKeyUp(event: React.KeyboardEvent<HTMLCanvasElement>): void {
    event.preventDefault();
    event.stopPropagation();
    send({ type: "keyUp", key: event.key });
  }

  function toggleRecording(): void {
    const next = !isRecording;
    setIsRecording(next);
    isRecordingRef.current = next;
    send({ type: next ? "startRecording" : "stopRecording" });
  }

  function handleValidate(): void {
    onValidate(accumulatedSteps);
    onClose();
  }

  function removeAccumulatedStep(index: number): void {
    setAccumulatedSteps((current) => current.filter((_, i) => i !== index));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2">
      <div className="flex h-full w-full overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-1 flex-col border-r border-gray-200">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <h2 className="text-sm font-semibold text-gray-900">Aperçu en direct</h2>
            <span className="truncate text-xs text-gray-400">{startUrl}</span>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto bg-gray-900">
            {status === "connecting" && <p className="text-sm text-gray-300">Connexion…</p>}
            {errorMessage && <p className="p-4 text-sm text-red-400">{errorMessage}</p>}
            {!errorMessage && (
              <canvas
                ref={canvasRef}
                tabIndex={0}
                onMouseMove={handleMouseMove}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                className={`max-h-full max-w-full outline-none ${status === "ready" ? "cursor-crosshair" : "hidden"}`}
              />
            )}
          </div>
        </div>

        <div className="flex w-96 flex-shrink-0 flex-col">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <h3 className="text-sm font-semibold text-gray-900">Enregistrement</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            >
              Fermer
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {replaceLabel && (
              <p className="mb-3 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                Remplace l&apos;étape existante : <span className="font-mono">{replaceLabel}</span>
              </p>
            )}
            <button
              type="button"
              onClick={toggleRecording}
              disabled={status !== "ready"}
              className={`w-full rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                isRecording
                  ? "bg-red-600 text-white hover:bg-red-500"
                  : "border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              }`}
            >
              {isRecording ? "● Arrêter l'enregistrement" : "Enregistrer"}
            </button>
            <p className="mt-1 text-xs text-gray-400">
              Interagissez directement dans l&apos;aperçu (clic, saisie, sélection) pendant que
              l&apos;enregistrement est actif — chaque action reconnue apparaît ci-dessous.
            </p>

            <div className="mt-4 space-y-1">
              {accumulatedSteps.length === 0 && (
                <p className="text-xs text-gray-400">Aucune action enregistrée pour l&apos;instant.</p>
              )}
              {accumulatedSteps.map((step, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                >
                  <span className="truncate font-mono text-gray-700">{JSON.stringify(step)}</span>
                  <button
                    type="button"
                    onClick={() => removeAccumulatedStep(index)}
                    className="flex-shrink-0 text-red-500 hover:text-red-700"
                  >
                    supprimer
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={handleValidate}
              disabled={accumulatedSteps.length === 0}
              className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {replaceLabel ? "Remplacer" : "Valider"} ({accumulatedSteps.length} action
              {accumulatedSteps.length === 1 ? "" : "s"})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
