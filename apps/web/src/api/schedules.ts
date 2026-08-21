import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type { CreateScheduleInput, ScheduleDto } from "./types";

/**
 * Query key schema, mirroring src/api/executions.ts's convention:
 *  - ["schedules", "list", workflowId] -> ScheduleDto[] for one workflow
 *
 * There is no per-id detail query: the panel that uses these hooks (SchedulesPanel) only ever
 * needs the list for the workflow currently open in the editor.
 */

export function useSchedules(workflowId: string | undefined) {
  return useQuery({
    queryKey: ["schedules", "list", workflowId],
    queryFn: () => apiRequest<ScheduleDto[]>(`/workflows/${workflowId}/schedules`),
    enabled: Boolean(workflowId),
  });
}

export function useCreateSchedule(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduleInput) =>
      apiRequest<ScheduleDto>(`/workflows/${workflowId}/schedules`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules", "list", workflowId] });
    },
  });
}

export function useSetScheduleEnabled(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiRequest<ScheduleDto>(`/schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules", "list", workflowId] });
    },
  });
}

export function useDeleteSchedule(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/schedules/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules", "list", workflowId] });
    },
  });
}
