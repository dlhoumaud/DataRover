import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Project as ProjectRow } from "@datarover/database";
import { PrismaService } from "../prisma/prisma.service";
import { SchedulesService } from "../schedules/schedules.service";
import type { CreateProjectDto, UpdateProjectDto } from "./dto";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulesService: SchedulesService,
  ) {}

  async create(dto: CreateProjectDto): Promise<ProjectRow> {
    return this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description,
        variables: dto.variables as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(): Promise<ProjectRow[]> {
    return this.prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  }

  async findOneOrThrow(id: string): Promise<ProjectRow> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }
    return project;
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectRow> {
    await this.findOneOrThrow(id);

    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.variables !== undefined
          ? { variables: dto.variables as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOneOrThrow(id);
    // See WorkflowsService.remove's identical comment — cascading through every workflow this
    // project owns.
    await this.schedulesService.removeAllJobSchedulersForProject(id);
    await this.prisma.project.delete({ where: { id } });
  }
}
