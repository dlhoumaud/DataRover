import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCreateProxy, useDeleteProxy, useProxies, useUpdateProxy } from "../api/proxies";
import type { ProxyStatus } from "../api/types";
import { ProxyStatusBadge } from "../components/ProxyStatusBadge";

const PAGE_SIZE = 20;

/**
 * Global proxy pool management (never project-scoped, unlike every other page in this app) —
 * list/create/edit-status/delete, with pagination and a status filter: the first paginated list
 * anywhere in this UI, since no other endpoint paginates yet either (see api/proxies.ts).
 */
export function ProxiesPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ProxyStatus | "">("");
  const [isCreating, setIsCreating] = useState(false);
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState("");

  const { data, isPending, isError, error } = useProxies({
    page,
    limit: PAGE_SIZE,
    status: statusFilter === "" ? undefined : statusFilter,
  });
  const createProxy = useCreateProxy();
  const updateProxy = useUpdateProxy();
  const deleteProxy = useDeleteProxy();

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  function handleCreate(): void {
    const port = Number(newPort);
    if (newHost.trim().length === 0 || !Number.isInteger(port) || port <= 0) {
      return;
    }
    createProxy.mutate(
      { host: newHost.trim(), port },
      {
        onSuccess: () => {
          setIsCreating(false);
          setNewHost("");
          setNewPort("");
        },
      },
    );
  }

  function handleToggleStatus(id: string, currentStatus: ProxyStatus): void {
    updateProxy.mutate({ id, input: { status: currentStatus === "active" ? "disabled" : "active" } });
  }

  function handleDelete(id: string, host: string, port: number): void {
    const confirmed = window.confirm(`Supprimer le proxy "${host}:${port}" ? Cette action est définitive.`);
    if (confirmed) {
      deleteProxy.mutate(id);
    }
  }

  function handleFilterChange(value: string): void {
    setStatusFilter(value === "" ? "" : (value as ProxyStatus));
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Proxies</h1>
        <div className="flex items-center gap-3">
          <Link to="/proxies/config" className="text-sm font-medium text-gray-600 hover:text-gray-900">
            ⚙ Configuration
          </Link>
          <button
            type="button"
            onClick={() => setIsCreating((prev) => !prev)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {isCreating ? "Annuler" : "Nouveau proxy"}
          </button>
        </div>
      </div>

      {isCreating ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-lg font-medium text-gray-900">Ajouter un proxy</h2>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Adresse / hostname</label>
              <input
                value={newHost}
                onChange={(event) => setNewHost(event.target.value)}
                placeholder="192.168.1.10"
                className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Port</label>
              <input
                type="number"
                value={newPort}
                onChange={(event) => setNewPort(event.target.value)}
                placeholder="8080"
                className="mt-1 w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createProxy.isPending}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Ajouter
            </button>
          </div>
          {createProxy.isError ? (
            <p className="mt-3 text-sm text-red-600">
              {createProxy.error instanceof ApiError ? createProxy.error.message : "Une erreur est survenue."}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700">Statut</label>
        <select
          value={statusFilter}
          onChange={(event) => handleFilterChange(event.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Tous</option>
          <option value="active">Actif</option>
          <option value="disabled">Désactivé</option>
        </select>
      </div>

      {isPending ? <p className="text-gray-600">Chargement...</p> : null}
      {isError ? (
        <p className="text-red-600">
          {error instanceof ApiError ? error.message : "Impossible de charger les proxies."}
        </p>
      ) : null}

      {!isPending && !isError && data ? (
        data.items.length === 0 ? (
          <p className="text-gray-600">Aucun proxy pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Adresse</th>
                  <th scope="col" className="px-4 py-3 font-medium">Port</th>
                  <th scope="col" className="px-4 py-3 font-medium">Statut</th>
                  <th scope="col" className="px-4 py-3 font-medium">Erreurs</th>
                  <th scope="col" className="px-4 py-3 font-medium">Utilisé</th>
                  <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.items.map((proxy) => (
                  <tr key={proxy.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-700">{proxy.host}</td>
                    <td className="px-4 py-3 text-gray-700">{proxy.port}</td>
                    <td className="px-4 py-3"><ProxyStatusBadge status={proxy.status} /></td>
                    <td className="px-4 py-3 text-gray-700">{proxy.errorCount}</td>
                    <td className="px-4 py-3 text-gray-700">{proxy.isInUse ? "Oui" : "Non"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(proxy.id, proxy.status)}
                        disabled={updateProxy.isPending}
                        className="mr-3 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        {proxy.status === "active" ? "Désactiver" : "Activer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(proxy.id, proxy.host, proxy.port)}
                        disabled={deleteProxy.isPending}
                        className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {data && data.total > 0 ? (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Page {data.page} / {totalPages} ({data.total} proxy{data.total === 1 ? "" : "s"})
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Précédent
            </button>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        </div>
      ) : null}

      {updateProxy.isError ? (
        <p className="text-sm text-red-600">
          {updateProxy.error instanceof ApiError ? updateProxy.error.message : "Une erreur est survenue."}
        </p>
      ) : null}
      {deleteProxy.isError ? (
        <p className="text-sm text-red-600">
          {deleteProxy.error instanceof ApiError ? deleteProxy.error.message : "Une erreur est survenue."}
        </p>
      ) : null}
    </div>
  );
}
