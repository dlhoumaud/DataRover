import { BadRequestException, Injectable } from "@nestjs/common";
import { request } from "undici";
import { interpolate, type ExpressionContext } from "@datarover/expression-engine";
import { extractWithCss, type ExtractionOutcome } from "@datarover/extractor";
import { PrismaService } from "../prisma/prisma.service";
import type { PreviewAssetDto, PreviewHtmlDto, TestSelectorDto } from "./dto";

/** Safety cap so a pathologically large response can't blow up the browser tab rendering it. */
const MAX_HTML_LENGTH = 5_000_000;

/** Preview must fail fast — this is an interactive editor tool, not a queued crawl. */
const PREVIEW_TIMEOUT_MS = 10_000;

const BODYLESS_METHODS = new Set(["GET", "DELETE"]);

/** A single proxied asset can be a bit larger than the HTML cap (real product photos), but still bounded. */
const MAX_ASSET_LENGTH = 15_000_000;
const ASSET_TIMEOUT_MS = 10_000;

export interface PreviewHtmlResult {
  status: number;
  html: string;
  /**
   * The fully-resolved absolute URL actually fetched (interpolation +
   * query params applied). The frontend uses this as the sandboxed
   * preview's `<base href>` so relative image/CSS URLs on the fetched page
   * resolve against the real site instead of the app's own origin.
   */
  url: string;
}

/**
 * Backs the editor's "Prévisualiser & sélectionner" tool (Specs.md §6/§8). Deliberately stays a
 * synchronous, bounded, one-shot HTTP round trip plus a pure extraction call — it never touches
 * `@datarover/workflow-core` (the API must never run the workflow engine itself, see
 * ARCHITECTURE.md's iteration 2 notes); `@datarover/expression-engine` and `@datarover/extractor`
 * are plain libraries already used elsewhere in the monorepo.
 */
@Injectable()
export class ToolsService {
  constructor(private readonly prisma: PrismaService) {}

  async previewHtml(input: PreviewHtmlDto): Promise<PreviewHtmlResult> {
    const project = await this.prisma.project.findUnique({ where: { id: input.projectId } });
    if (!project) {
      throw new BadRequestException(`Project ${input.projectId} not found`);
    }

    const context: ExpressionContext = {
      global: (project.variables ?? {}) as Record<string, unknown>,
    };

    const interpolatedUrl = interpolate(input.url, context);
    if (typeof interpolatedUrl !== "string") {
      throw new BadRequestException("The interpolated URL is not a string");
    }

    let target: URL;
    try {
      target = new URL(interpolatedUrl);
    } catch {
      throw new BadRequestException(`Invalid URL after interpolation: "${interpolatedUrl}"`);
    }

    const queryParams = input.queryParams
      ? (interpolate(input.queryParams, context) as Record<string, string>)
      : undefined;
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        target.searchParams.set(key, value);
      }
    }

    const headers = input.headers
      ? (interpolate(input.headers, context) as Record<string, string>)
      : undefined;
    const hasBody = input.body !== undefined && !BODYLESS_METHODS.has(input.method);
    const interpolatedBody = hasBody ? interpolate(input.body, context) : undefined;

    try {
      const response = await request(target, {
        method: input.method,
        headers: hasBody ? { "content-type": "application/json", ...headers } : headers,
        body: hasBody ? JSON.stringify(interpolatedBody) : undefined,
        headersTimeout: PREVIEW_TIMEOUT_MS,
        bodyTimeout: PREVIEW_TIMEOUT_MS,
      });
      const text = await response.body.text();
      const html = text.length > MAX_HTML_LENGTH ? text.slice(0, MAX_HTML_LENGTH) : text;
      return { status: response.statusCode, html, url: target.toString() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to fetch "${target.toString()}": ${message}`);
    }
  }

  testSelector(input: TestSelectorDto): ExtractionOutcome {
    return extractWithCss(input.html, {
      name: "preview",
      strategy: "css",
      selectors: input.selectors,
      output: input.output ?? "list",
      attribute: input.attribute,
    });
  }

  async previewAsset(input: PreviewAssetDto): Promise<{ contentType: string; body: Buffer }> {
    let target: URL;
    try {
      target = new URL(input.url);
    } catch {
      throw new BadRequestException(`Invalid asset URL: "${input.url}"`);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new BadRequestException(`Unsupported protocol for asset URL: "${target.protocol}"`);
    }

    try {
      const response = await request(target, {
        method: "GET",
        headersTimeout: ASSET_TIMEOUT_MS,
        bodyTimeout: ASSET_TIMEOUT_MS,
      });

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += (chunk as Buffer).length;
        if (size > MAX_ASSET_LENGTH) {
          throw new BadRequestException(
            `Asset "${target.toString()}" exceeds the ${MAX_ASSET_LENGTH} byte cap`,
          );
        }
        chunks.push(chunk as Buffer);
      }

      const contentTypeHeader = response.headers["content-type"];
      const resolvedContentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader[0]
        : contentTypeHeader;

      return { contentType: resolvedContentType ?? "application/octet-stream", body: Buffer.concat(chunks) };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Failed to fetch asset "${target.toString()}": ${message}`);
    }
  }
}
