import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SessionRunSchema, type SessionRunDto } from "./dto";
import { SessionService, type SessionRunResult } from "./session.service";

@Controller("session")
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post("run")
  @HttpCode(HttpStatus.OK)
  run(@Body(new ZodValidationPipe(SessionRunSchema)) body: SessionRunDto): Promise<SessionRunResult> {
    return this.sessionService.run(body.startUrl, body.steps);
  }
}
