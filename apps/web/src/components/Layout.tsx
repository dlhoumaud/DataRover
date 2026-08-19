import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useHealth } from "../api/health";

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

export function Layout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-semibold text-gray-900 hover:text-gray-700">
            DataRover
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/" className="text-sm font-medium text-gray-600 hover:text-gray-900">
              Accueil
            </Link>
            <HealthBadge />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
