import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Workflow, type WorkflowVersion } from "@datarover/database";
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "@datarover/workflow-types";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulesService } from "../schedules/schedules.service";
import type { CreateWorkflowDto, UpdateWorkflowDto } from "./dto";

export interface WorkflowSummary extends Workflow {
  latestVersion: number;
}

export interface WorkflowCurrentVersion {
  version: number;
  definition: WorkflowDefinition;
  createdAt: Date;
}

export interface WorkflowWithCurrentVersion extends Workflow {
  currentVersion: WorkflowCurrentVersion;
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulesService: SchedulesService,
  ) {}

  async create(projectId: string, dto: CreateWorkflowDto): Promise<WorkflowWithCurrentVersion> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const workflow = await this.prisma.workflow.create({
      data: { projectId, name: dto.name },
    });

    // Defense in depth: re-validate the full definition (with `id` now
    // known) even though the controller's ZodValidationPipe already
    // validated the omit({id: true}) shape of the payload.
    const definition = WorkflowDefinitionSchema.parse({
      ...dto.definition,
      id: workflow.id,
    });

    const workflowVersion = await this.prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        definition: definition as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      ...workflow,
      currentVersion: {
        version: workflowVersion.version,
        definition,
        createdAt: workflowVersion.createdAt,
      },
    };
  }

  async findAllForProject(projectId: string): Promise<WorkflowSummary[]> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const workflows = await this.prisma.workflow.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all(
      workflows.map(async (workflow) => {
        const latest = await this.latestVersionOrThrow(workflow.id);
        return { ...workflow, latestVersion: latest.version };
      }),
    );
  }

  async findOneOrThrow(id: string): Promise<WorkflowWithCurrentVersion> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }

    const current = await this.latestVersionOrThrow(id);

    return {
      ...workflow,
      currentVersion: {
        version: current.version,
        definition: WorkflowDefinitionSchema.parse(current.definition),
        createdAt: current.createdAt,
      },
    };
  }

  async update(id: string, dto: UpdateWorkflowDto): Promise<WorkflowWithCurrentVersion> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }

    if (dto.name !== undefined) {
      await this.prisma.workflow.update({ where: { id }, data: { name: dto.name } });
    }

    if (dto.definition !== undefined) {
      const current = await this.latestVersionOrThrow(id);

      // Defense in depth: re-validate before persisting a new version.
      const definition = WorkflowDefinitionSchema.parse({
        ...dto.definition,
        id,
      });

      await this.prisma.workflowVersion.create({
        data: {
          workflowId: id,
          version: current.version + 1,
          definition: definition as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return this.findOneOrThrow(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Workflow ${id} not found`);
    }
    // Postgres's ON DELETE CASCADE removes this workflow's Schedule rows, but has no way to also
    // clean up the BullMQ job scheduler each one may have registered — do that first.
    await this.schedulesService.removeAllJobSchedulersForWorkflow(id);
    await this.prisma.workflow.delete({ where: { id } });
  }

  private async latestVersionOrThrow(workflowId: string): Promise<WorkflowVersion> {
    const version = await this.prisma.workflowVersion.findFirst({
      where: { workflowId },
      orderBy: { version: "desc" },
    });
    if (!version) {
      throw new BadRequestException(`Workflow ${workflowId} has no versions`);
    }
    return version;
  }
}
