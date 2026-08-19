import { useParams } from "react-router-dom";
import { useExecution } from "../api/executions";
import { TERMINAL_EXECUTION_STATUSES } from "../api/types";
import type { ExecutionLogDto } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";

/**
 * Log-level colors, chosen to echo StatusBadge's palette for visual
 * consistency: error=red (like "failed"), warn=orange (like "retrying"),
 * info=gray (like "pending"/"cancelled"), debug=lighter gray.
 */
const LOG_LEVEL_STYLES: Record<ExecutionLogDto["level"], string> = {
  error: "text-red-700",
  warn: "text-orange-600",
  info: "text-gray-600",
  debug: "text-gray-400",
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}

/** Formats an ISO timestamp as a local "HH:MM:SS" clock time. */
function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatOutput(output: unknown): string {
  return JSON.stringify(output, null, 2);
}

/**
 * Execution detail / live-tracking view — route `/executions/:executionId`.
 *
 * `useExecution` already polls every second while the execution hasn't
 * reached a terminal status, so this component only needs to render
 * whatever `data.status` currently is; the "Suivi en direct..." indicator
 * below is purely presentational (same non-terminal check the polling
 * itself relies on).
 */
export function ExecutionDetailPage(): JSX.Element {
  const { executionId } = useParams<{ executionId: string }>();
  const { data, isPending, isError, error } = useExecution(executionId);

  if (isPending) {
    return <p className="text-sm text-gray-500">Chargement de l'exécution…</p>;
  }

  if (isError) {
    return (
      <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
        Impossible de charger l'exécution{error ? ` : ${error.message}` : ""}.
      </p>
    );
  }

  if (!data) {
    return <p className="text-sm text-gray-500">Exécution introuvable.</p>;
  }

  const isLive = !TERMINAL_EXECUTION_STATUSES.includes(data.status);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Exécution {data.id}</h1>
          <StatusBadge status={data.status} />
        </div>
        {isLive && (
          <p className="flex items-center gap-2 text-sm font-medium text-blue-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
            Suivi en direct...
          </p>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Démarrée le</dt>
          <dd className="mt-1 text-sm text-gray-900">{formatDateTime(data.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Terminée le</dt>
          <dd className="mt-1 text-sm text-gray-900">{formatDateTime(data.finishedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Créée le</dt>
          <dd className="mt-1 text-sm text-gray-900">{formatDateTime(data.createdAt)}</dd>
        </div>
      </dl>

      {data.error && (
        <section className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">Erreur d'exécution</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-red-700">{data.error}</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Résultats des actions</h2>
        {data.actionResults.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun résultat d'action pour l'instant.</p>
        ) : (
          <ul className="space-y-3">
            {data.actionResults.map((result, index) => (
              <li
                key={`${result.nodeId}-${index}`}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-gray-900">{result.nodeId}</span>
                    <StatusBadge status={result.status} />
                  </div>
                  <span className="text-xs text-gray-500">
                    {result.attempts} tentative{result.attempts === 1 ? "" : "s"}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-gray-500 sm:grid-cols-2">
                  <div>
                    <dt className="uppercase tracking-wide">Démarré</dt>
                    <dd className="text-gray-700">{formatDateTime(result.startedAt)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wide">Terminé</dt>
                    <dd className="text-gray-700">{formatDateTime(result.finishedAt)}</dd>
                  </div>
                </dl>

                {result.error && (
                  <p className="mt-3 whitespace-pre-wrap rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {result.error}
                  </p>
                )}

                {result.output !== undefined && (
                  <pre className="mt-3 overflow-x-auto rounded-md bg-gray-900 px-3 py-2 text-xs text-gray-100">
                    {formatOutput(result.output)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Journal d'exécution</h2>
        {data.logs.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune entrée de journal pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="space-y-1 font-mono text-xs leading-relaxed">
              {data.logs.map((log) => (
                <div key={log.id} className={LOG_LEVEL_STYLES[log.level]}>
                  [{formatClockTime(log.timestamp)}] {log.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
