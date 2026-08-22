import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type {
  CreateProxyInput,
  ProxyConfigDto,
  ProxyDto,
  ProxyListDto,
  ProxyStatus,
  UpdateProxyConfigInput,
  UpdateProxyInput,
} from "./types";

/**
 * Query key schema:
 *  - ["proxies", "list", {page, limit, status}] -> ProxyListDto (one page)
 *  - ["proxies", "config"]                      -> ProxyConfigDto
 *
 * Global (never project-scoped) — see types.ts's own doc comment on why this whole file has no
 * parent id threaded through it, unlike e.g. schedules.ts's workflow-scoped hooks.
 */

export interface ProxiesListParams {
  page: number;
  limit: number;
  status?: ProxyStatus;
}

function buildProxiesQuery({ page, limit, status }: ProxiesListParams): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status !== undefined) {
    params.set("status", status);
  }
  return params.toString();
}

export function useProxies(params: ProxiesListParams) {
  return useQuery({
    queryKey: ["proxies", "list", params],
    queryFn: () => apiRequest<ProxyListDto>(`/proxies?${buildProxiesQuery(params)}`),
  });
}

export function useCreateProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProxyInput) =>
      apiRequest<ProxyDto>("/proxies", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxies", "list"] });
    },
  });
}

export function useUpdateProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProxyInput }) =>
      apiRequest<ProxyDto>(`/proxies/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxies", "list"] });
    },
  });
}

export function useDeleteProxy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/proxies/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxies", "list"] });
    },
  });
}

export function useProxyConfig() {
  return useQuery({
    queryKey: ["proxies", "config"],
    queryFn: () => apiRequest<ProxyConfigDto>("/proxies/config"),
  });
}

export function useUpdateProxyConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProxyConfigInput) =>
      apiRequest<ProxyConfigDto>("/proxies/config", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["proxies", "config"] });
    },
  });
}
