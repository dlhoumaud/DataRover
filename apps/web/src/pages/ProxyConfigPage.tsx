import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useProxyConfig, useUpdateProxyConfig } from "../api/proxies";

/**
 * Global proxy-pool configuration — distinct from the proxy list itself (ProxiesPage), per the
 * user's own request: "Créer une page ou section globale de configuration du système de proxy,
 * distincte de la liste des proxies." Just the purge threshold for now; a natural place to add
 * more pool-wide settings later without cluttering the list page.
 */
export function ProxyConfigPage(): JSX.Element {
  const { data, isPending, isError, error } = useProxyConfig();
  const updateConfig = useUpdateProxyConfig();
  const [threshold, setThreshold] = useState("");

  useEffect(() => {
    if (data) {
      setThreshold(String(data.purgeErrorThreshold));
    }
  }, [data]);

  function handleSave(): void {
    const value = Number(threshold);
    if (!Number.isInteger(value) || value <= 0) {
      return;
    }
    updateConfig.mutate({ purgeErrorThreshold: value });
  }

  return (
    <div className="max-w-md space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Configuration du pool de proxies</h1>
        <Link to="/proxies" className="text-sm font-medium text-gray-600 hover:text-gray-900">
          ← Retour aux proxies
        </Link>
      </div>

      {isPending ? <p className="text-gray-600">Chargement...</p> : null}
      {isError ? (
        <p className="text-red-600">
          {error instanceof ApiError ? error.message : "Impossible de charger la configuration."}
        </p>
      ) : null}

      {!isPending && !isError ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <label className="block text-sm font-medium text-gray-700">
            Purge automatique après combien d'erreurs
          </label>
          <input
            type="number"
            min={1}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            className="mt-1 w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
          <p className="mt-2 text-xs text-gray-400">
            Un proxy est définitivement supprimé du pool dès que son nombre d'erreurs atteint ce
            seuil (5 par défaut).
          </p>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateConfig.isPending}
            className="mt-4 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Enregistrer
          </button>
          {updateConfig.isSuccess ? <p className="mt-2 text-sm text-green-600">Enregistré.</p> : null}
          {updateConfig.isError ? (
            <p className="mt-2 text-sm text-red-600">
              {updateConfig.error instanceof ApiError ? updateConfig.error.message : "Une erreur est survenue."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
