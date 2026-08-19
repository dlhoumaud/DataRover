import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";
import { TERMINAL_EXECUTION_STATUSES } from "./types";
import type { ExecutionDetailDto, ExecutionSummaryDto } from "./types";

/**
 * Query key schema, mirroring src/api/workflows.ts's convention:
 *  - ["executions", "list", workflowId] -> ExecutionSummaryDto[] for one workflow
 *  - ["executions", "detail", id]       -> ExecutionDetailDto for one execution
 */

export function useCreateExecution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) =>
      apiRequest<ExecutionSummaryDto>(`/workflows/${workflowId}/executions`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["executions", "list", data.workflowId] });
    },
  });
}

/**
 * Polls the execution every second until it reaches a terminal status
 * (see TERMINAL_EXECUTION_STATUSES). This is the real-time tracking
 * mechanism for this iteration — no WebSocket involved.
 */
export function useExecution(id: string | undefined) {
  return useQuery({
    queryKey: ["executions", "detail", id],
    queryFn: () => apiRequest<ExecutionDetailDto>(`/executions/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && TERMINAL_EXECUTION_STATUSES.includes(status) ? false : 1000;
    },
  });
}

export function useExecutions(workflowId: string | undefined) {
  return useQuery({
    queryKey: ["executions", "list", workflowId],
    queryFn: () => apiRequest<ExecutionSummaryDto[]>(`/workflows/${workflowId}/executions`),
    enabled: Boolean(workflowId),
  });
}
