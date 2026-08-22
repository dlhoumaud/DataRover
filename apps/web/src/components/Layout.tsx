import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useHealth } from "../api/health";

/** Matches WorkflowEditorPage's route exactly (App.tsx) — not the .../executions sub-route. */
const WORKFLOW_EDITOR_PATH = /^\/projects\/[^/]+\/workflows\/[^/]+$/;

/**
 * Status badge reflecting the API health probe (see `useHealth`):
 *  - pending  -> grey "..."
 *  - error    -> red "Hors ligne"
 *  - "ok"     -> green "API OK"
 *  - "degraded" -> orange "Dégradé"
 */
function HealthBadge(): JSX.Element {
  const { data, isPending, isError } = useHealth();

  if (isPending) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
        <span className="h-2 w-2 rounded-full bg-gray-400" aria-hidden="true" />
        ...
      </span>
    );
  }

  if (isError) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700">
        <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
        Hors ligne
      </span>
    );
  }

  if (data?.status === "degraded") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-sm font-medium text-orange-700">
        <span className="h-2 w-2 rounded-full bg-orange-500" aria-hidden="true" />
        Dégradé
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
      <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
      API OK
    </span>
  );
}

/**
 * The workflow editor (React Flow + its own header/palette) is meant to fill the whole window —
 * the standard `max-w-5xl` centered/padded content column everywhere else would otherwise box it
 * in. Detected from the URL (rather than a prop `App.tsx` would have to thread through) since
 * `Layout` wraps the whole `<Routes>` as a single instance.
 */
export function Layout({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const isWorkflowEditor = WORKFLOW_EDITOR_PATH.test(location.pathname);

  return (
    <div className={`flex flex-col bg-gray-50 ${isWorkflowEditor ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      <header className="flex-shrink-0 border-b border-gray-200 bg-white">
        <div className="flex w-full items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-semibold text-gray-900 hover:text-gray-700">
            <img src="/logo-256.png" alt="" className="h-8 w-8" />
            DataRover
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/proxies" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Proxies
            </Link>
            <HealthBadge />
          </nav>
        </div>
      </header>
      <main className={isWorkflowEditor ? "flex min-h-0 flex-1 flex-col" : "mx-auto max-w-5xl px-4 py-8"}>
        {children}
      </main>
    </div>
  );
}
