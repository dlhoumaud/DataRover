import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CreateScheduleSchema, UpdateScheduleSchema, type CreateScheduleDto, type UpdateScheduleDto } from "./dto";
import { SchedulesService } from "./schedules.service";

/**
 * Routes span two URL shapes (`/workflows/:workflowId/schedules` and `/schedules/:id`), so this
 * controller uses an empty prefix and spells out the full path on each handler — same convention
 * as ExecutionsController/WorkflowsController.
 */
@Controller()
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Post("workflows/:workflowId/schedules")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("workflowId") workflowId: string,
    @Body(new ZodValidationPipe(CreateScheduleSchema)) body: CreateScheduleDto,
  ) {
    return this.schedulesService.createForWorkflow(workflowId, body);
  }

  @Get("workflows/:workflowId/schedules")
  findAllForWorkflow(@Param("workflowId") workflowId: string) {
    return this.schedulesService.findAllForWorkflow(workflowId);
  }

  @Patch("schedules/:id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateScheduleSchema)) body: UpdateScheduleDto,
  ) {
    return this.schedulesService.setEnabled(id, body.enabled);
  }

  @Delete("schedules/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.schedulesService.remove(id);
  }
}
