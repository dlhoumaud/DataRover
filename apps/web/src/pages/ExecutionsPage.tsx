import { Link, useParams } from "react-router-dom";
import { useExecutions } from "../api/executions";
import { StatusBadge } from "../components/StatusBadge";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}

/**
 * Formats `finishedAt - startedAt` as a short human duration, or "—" when
 * either bound is missing (execution not started, or still running).
 */
function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) {
    return "—";
  }

  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }

  if (ms < 1000) {
    return `${ms} ms`;
  }

  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes} min ${seconds.toString().padStart(2, "0")} s`;
}

/**
 * Execution history for one workflow — route
 * `/projects/:projectId/workflows/:workflowId/executions`.
 */
export function ExecutionsPage(): JSX.Element {
  const { projectId, workflowId } = useParams<{ projectId: string; workflowId: string }>();
  const { data, isPending, isError, error } = useExecutions(workflowId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Historique des exécutions</h1>
        <Link
          to={`/projects/${projectId}/workflows/${workflowId}`}
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          ← Retour à l'éditeur
        </Link>
      </div>

      {isPending && <p className="text-sm text-gray-500">Chargement des exécutions…</p>}

      {isError && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Impossible de charger les exécutions{error ? ` : ${error.message}` : ""}.
        </p>
      )}

      {!isPending && !isError && data && data.length === 0 && (
        <p className="text-sm text-gray-500">Aucune exécution pour l'instant.</p>
      )}

      {!isPending && !isError && data && data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Statut
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Créée le
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Durée
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((execution) => (
                <tr key={execution.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <StatusBadge status={execution.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {formatDateTime(execution.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                    {formatDuration(execution.startedAt, execution.finishedAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Link
                      to={`/executions/${execution.id}`}
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      Voir le détail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
