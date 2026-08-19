import { z } from "zod";
import { ExtractOutputType, HttpMethod } from "@datarover/workflow-types";

/**
 * Fetches a URL on behalf of the editor's HTML preview/selection tool (Specs.md §6). Mirrors the
 * relevant subset of an `http` node's fields — interpolation happens server-side against the
 * target project's global variables, exactly like a real execution would, so the preview is
 * faithful to what running the node would actually fetch.
 */
export const PreviewHtmlSchema = z.object({
  projectId: z.string().min(1),
  method: HttpMethod,
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});
export type PreviewHtmlDto = z.infer<typeof PreviewHtmlSchema>;

/**
 * Tests a fallback chain of CSS selectors against an already-fetched HTML document (the one
 * `preview-html` just returned) — delegates straight to `@datarover/extractor`'s `extractWithCss`
 * so the score/result shown while picking an element in the UI is exactly what a real `extract`
 * node would compute, not a separate approximation.
 */
export const TestSelectorSchema = z.object({
  html: z.string(),
  selectors: z.array(z.string()).min(1),
  output: ExtractOutputType.optional(),
  attribute: z.string().optional(),
});
export type TestSelectorDto = z.infer<typeof TestSelectorSchema>;

/**
 * Fetches a single asset (image, for now — see ToolsService.previewAsset) on the browser's
 * behalf so it loads from our own origin instead of the target site directly. Real-world finding:
 * several sites' image CDNs block requests made from the preview iframe's opaque origin (no
 * Referer) even though the exact same undici client, run server-side, fetches the very same asset
 * without issue — proxying through the backend sidesteps that unreliability entirely. `url` is
 * already an absolute URL, resolved client-side against the preview's base URL — no per-project
 * interpolation applies here (unlike preview-html), since this never carries `{{ }}` expressions.
 */
export const PreviewAssetSchema = z.object({
  url: z.string().min(1),
});
export type PreviewAssetDto = z.infer<typeof PreviewAssetSchema>;
