import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RenderSchema, type RenderDto } from "./dto";
import { RenderService, type RenderedPage } from "./render.service";

@Controller()
export class RenderController {
  constructor(private readonly renderService: RenderService) {}

  @Post("render")
  @HttpCode(HttpStatus.OK)
  render(@Body(new ZodValidationPipe(RenderSchema)) body: RenderDto): Promise<RenderedPage> {
    return this.renderService.render(body.url, body.headers);
  }
}
