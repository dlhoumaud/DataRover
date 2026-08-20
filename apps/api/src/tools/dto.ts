import { z } from "zod";
import { ExtractOutputType, ExtractSourceType, HttpMethod } from "@datarover/workflow-types";

/**
 * Fetches a URL on behalf of the editor's preview/selection tool (Specs.md §6). Mirrors the
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
  /**
   * When true, the page is rendered in a real headless browser instead of plain-fetched — for
   * targets whose actual content only exists after client-side JS runs (a SPA shell with no
   * meaningful server-rendered markup). Slower (real navigation + wait for network idle) and only
   * supported for GET, matching normal page-navigation semantics — see BrowserRendererService.
   * Only meaningful for `responseType: "html"` — the frontend never sets it otherwise.
   */
  render: z.boolean().optional(),
});
export type PreviewHtmlDto = z.infer<typeof PreviewHtmlSchema>;

/**
 * Tests a fallback chain of selectors against an already-fetched source document (whatever
 * `preview-html` just returned) — delegates straight to `@datarover/extractor`'s real
 * `extractWithCss`/`extractWithJsonPath`/`extractWithXml` (picked via `sourceType`, mirroring the
 * `extract()` dispatcher's own strategy selection) so the score/result shown while picking an
 * element in the UI is exactly what a real `extract` node would compute, not a separate
 * approximation. `source` is the raw fetched body text regardless of `sourceType` — for "json" and
 * "xml" it's parsed server-side (the same parsing a real `extract` node would apply), never
 * pre-parsed by the caller.
 */
export const TestSelectorSchema = z.object({
  source: z.string(),
  sourceType: ExtractSourceType.default("html"),
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
