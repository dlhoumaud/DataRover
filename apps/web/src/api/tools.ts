import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "./client";
import type {
  PreviewHtmlInput,
  PreviewHtmlResultDto,
  TestSelectorInput,
  TestSelectorResultDto,
} from "./types";

/**
 * Both hooks back the editor's "Prévisualiser & sélectionner" tool
 * (Specs.md §6/§8, see HtmlPreviewSelector). Neither is a resource with an
 * identity worth caching — each call is a one-shot action triggered by an
 * explicit user gesture (open the preview, click a candidate element) — so,
 * unlike src/api/workflows.ts and src/api/executions.ts, there is no
 * queryKey/useQuery/invalidateQueries here, just plain mutations.
 */

export function usePreviewHtml() {
  return useMutation({
    mutationFn: (input: PreviewHtmlInput) =>
      apiRequest<PreviewHtmlResultDto>("/tools/preview-html", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useTestSelector() {
  return useMutation({
    mutationFn: (input: TestSelectorInput) =>
      apiRequest<TestSelectorResultDto>("/tools/test-selector", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}
