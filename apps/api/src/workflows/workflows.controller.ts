import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
  CreateWorkflowSchema,
  UpdateWorkflowSchema,
  type CreateWorkflowDto,
  type UpdateWorkflowDto,
} from "./dto";
import { WorkflowsService } from "./workflows.service";

/**
 * Routes span two URL shapes (`/projects/:projectId/workflows` and
 * `/workflows/:id`), so this controller uses an empty prefix and spells out
 * the full path on each handler instead of a single `@Controller("...")`.
 */
@Controller()
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post("projects/:projectId/workflows")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(CreateWorkflowSchema)) body: CreateWorkflowDto,
  ) {
    return this.workflowsService.create(projectId, body);
  }

  @Get("projects/:projectId/workflows")
  findAllForProject(@Param("projectId") projectId: string) {
    return this.workflowsService.findAllForProject(projectId);
  }

  @Get("workflows/:id")
  findOne(@Param("id") id: string) {
    return this.workflowsService.findOneOrThrow(id);
  }

  @Patch("workflows/:id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateWorkflowSchema)) body: UpdateWorkflowDto,
  ) {
    return this.workflowsService.update(id, body);
  }

  @Delete("workflows/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.workflowsService.remove(id);
  }
}
