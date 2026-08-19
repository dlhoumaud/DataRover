import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type { HealthDto } from "./types";

/**
 * Background-refreshed health probe, intended to back a status badge in
 * the app layout (e.g. a header indicator for API/DB/Redis reachability).
 */
export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiRequest<HealthDto>("/health"),
    refetchInterval: 15000,
  });
}
