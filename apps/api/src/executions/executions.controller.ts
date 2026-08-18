import { Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ExecutionsService } from "./executions.service";

/**
 * Routes span two URL shapes (`/workflows/:workflowId/executions` and
 * `/executions/:id`), so this controller uses an empty prefix and spells
 * out the full path on each handler instead of a single `@Controller("...")`.
 */
@Controller()
export class ExecutionsController {
  constructor(private readonly executionsService: ExecutionsService) {}

  @Post("workflows/:workflowId/executions")
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Param("workflowId") workflowId: string) {
    return this.executionsService.createForWorkflow(workflowId);
  }

  @Get("executions/:id")
  findOne(@Param("id") id: string) {
    return this.executionsService.findOneWithLogs(id);
  }

  @Get("workflows/:workflowId/executions")
  findAllForWorkflow(@Param("workflowId") workflowId: string) {
    return this.executionsService.findAllForWorkflow(workflowId);
  }
}
