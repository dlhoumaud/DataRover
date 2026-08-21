import { Injectable, NotFoundException } from "@nestjs/common";
import type { Schedule as ScheduleRow } from "@datarover/database";
import { PrismaService } from "../prisma/prisma.service";
import { ScheduleQueueService } from "./schedule-queue.service";
import { scheduleToRepeatOptions } from "./schedule-repeat";
import type { CreateScheduleDto } from "./dto";

/**
 * IMPORTANT: mirrors `ExecutionsService`'s own doc comment — this service only ever writes a
 * `Schedule` row and upserts/removes a BullMQ job scheduler. It never creates an `Execution` or
 * runs the workflow engine; turning a tick into an `Execution` is apps/worker's job (see
 * processScheduleTrigger.ts), which then enqueues onto the exact same queue a manual "Exécuter"
 * click does.
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleQueue: ScheduleQueueService,
  ) {}

  async createForWorkflow(workflowId: string, dto: CreateScheduleDto): Promise<ScheduleRow> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const schedule = await this.prisma.schedule.create({
      data: {
        workflowId,
        type: dto.type,
        everyMinutes: dto.everyMinutes,
        cronExpression: dto.cronExpression,
        enabled: dto.enabled,
      },
    });

    if (schedule.enabled) {
      await this.registerJobScheduler(schedule);
    }

    return schedule;
  }

  async findAllForWorkflow(workflowId: string): Promise<ScheduleRow[]> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    return this.prisma.schedule.findMany({ where: { workflowId }, orderBy: { createdAt: "asc" } });
  }

  async setEnabled(id: string, enabled: boolean): Promise<ScheduleRow> {
    const existing = await this.prisma.schedule.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Schedule ${id} not found`);
    }

    const updated = await this.prisma.schedule.update({ where: { id }, data: { enabled } });

    if (enabled) {
      await this.registerJobScheduler(updated);
    } else {
      await this.scheduleQueue.removeScheduler(id);
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.schedule.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Schedule ${id} not found`);
    }
    await this.scheduleQueue.removeScheduler(id);
    await this.prisma.schedule.delete({ where: { id } });
  }

  /**
   * Removes the BullMQ job scheduler for every schedule belonging to `workflowId`, without
   * touching the `Schedule` rows themselves — called just before a `Workflow` (or its parent
   * `Project`) is deleted, since Postgres's `ON DELETE CASCADE` cleans up the rows but has no way
   * to reach into Redis and clean up the corresponding BullMQ state. Best-effort: an already-gone
   * job scheduler is not an error (see `ScheduleQueueService.removeScheduler`).
   */
  async removeAllJobSchedulersForWorkflow(workflowId: string): Promise<void> {
    const schedules = await this.prisma.schedule.findMany({ where: { workflowId } });
    await Promise.all(schedules.map((schedule) => this.scheduleQueue.removeScheduler(schedule.id)));
  }

  /** Same as {@link removeAllJobSchedulersForWorkflow}, for every workflow under a project — used
   * just before a `Project` is deleted (which cascades through every one of its workflows). */
  async removeAllJobSchedulersForProject(projectId: string): Promise<void> {
    const schedules = await this.prisma.schedule.findMany({ where: { workflow: { projectId } } });
    await Promise.all(schedules.map((schedule) => this.scheduleQueue.removeScheduler(schedule.id)));
  }

  private async registerJobScheduler(schedule: ScheduleRow): Promise<void> {
    const repeatOpts = scheduleToRepeatOptions(schedule);
    if (!repeatOpts) {
      // type: "manual" — never fires automatically, nothing to register.
      return;
    }
    await this.scheduleQueue.upsertScheduler(schedule.id, repeatOpts, {
      scheduleId: schedule.id,
      workflowId: schedule.workflowId,
    });
  }
}
