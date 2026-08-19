import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type {
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowDetailDto,
  WorkflowSummaryDto,
} from "./types";

/**
 * Query key schema shared by every hook in this file (and referenced by
 * src/api/executions.ts's own workflow-scoped keys):
 *  - ["workflows", "list", projectId]   -> WorkflowSummaryDto[] for one project
 *  - ["workflows", "detail", id]        -> WorkflowDetailDto for one workflow
 *
 * useUpdateWorkflow reads `projectId` off the returned WorkflowDetailDto to
 * invalidate the owning project's list, so both the detail and list caches
 * stay consistent after a rename/definition change.
 */

export function useWorkflows(projectId: string | undefined) {
  return useQuery({
    queryKey: ["workflows", "list", projectId],
    queryFn: () => apiRequest<WorkflowSummaryDto[]>(`/projects/${projectId}/workflows`),
    enabled: Boolean(projectId),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ["workflows", "detail", id],
    queryFn: () => apiRequest<WorkflowDetailDto>(`/workflows/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateWorkflow(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkflowInput) =>
      apiRequest<WorkflowDetailDto>(`/projects/${projectId}/workflows`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "list", projectId] });
    },
  });
}

export function useUpdateWorkflow(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkflowInput) =>
      apiRequest<WorkflowDetailDto>(`/workflows/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "detail", id] });
      queryClient.invalidateQueries({ queryKey: ["workflows", "list", data.projectId] });
    },
  });
}

export function useDeleteWorkflow(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/workflows/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "list", projectId] });
    },
  });
}
