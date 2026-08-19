import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  PreviewAssetSchema,
  PreviewHtmlSchema,
  TestSelectorSchema,
  type PreviewAssetDto,
  type PreviewHtmlDto,
  type TestSelectorDto,
} from "./dto";
import { ToolsService } from "./tools.service";

@Controller("tools")
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Post("preview-html")
  @HttpCode(HttpStatus.OK)
  previewHtml(@Body(new ZodValidationPipe(PreviewHtmlSchema)) body: PreviewHtmlDto) {
    return this.toolsService.previewHtml(body);
  }

  @Post("test-selector")
  @HttpCode(HttpStatus.OK)
  testSelector(@Body(new ZodValidationPipe(TestSelectorSchema)) body: TestSelectorDto) {
    return this.toolsService.testSelector(body);
  }

  /**
   * `@Res()` (no `passthrough`) so the response body can be the asset's raw bytes with its own
   * `content-type` — thrown exceptions still go through Nest's normal exception filter, only the
   * success path bypasses Nest's own (JSON-oriented) response handling.
   */
  @Get("preview-asset")
  async previewAsset(
    @Query(new ZodValidationPipe(PreviewAssetSchema)) query: PreviewAssetDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { contentType, body } = await this.toolsService.previewAsset(query);
    reply.header("content-type", contentType).header("cache-control", "public, max-age=300").send(body);
  }
}
