import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  Execution as ExecutionRow,
  ExecutionLog as ExecutionLogRow,
} from "@datarover/database";
import { PrismaService } from "../prisma/prisma.service";
import { ExecutionQueueService } from "../queue/execution-queue.service";

export interface ExecutionWithLogs extends ExecutionRow {
  logs: ExecutionLogRow[];
}

/**
 * IMPORTANT: this service only ever writes an `Execution` row (status
 * "pending") and enqueues a job — it never runs the workflow engine.
 * Advancing an execution's status/logs/results is the sole responsibility
 * of apps/worker, which consumes the queue this service produces to.
 */
@Injectable()
export class ExecutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executionQueue: ExecutionQueueService,
  ) {}

  async createForWorkflow(workflowId: string): Promise<ExecutionRow> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    const currentVersion = await this.prisma.workflowVersion.findFirst({
      where: { workflowId },
      orderBy: { version: "desc" },
    });
    if (!currentVersion) {
      throw new BadRequestException(`Workflow ${workflowId} has no versions to execute`);
    }

    const execution = await this.prisma.execution.create({
      data: {
        workflowId,
        workflowVersionId: currentVersion.id,
        status: "pending",
      },
    });

    await this.executionQueue.enqueueExecution(execution.id);

    return execution;
  }

  async findOneWithLogs(id: string): Promise<ExecutionWithLogs> {
    const execution = await this.prisma.execution.findUnique({ where: { id } });
    if (!execution) {
      throw new NotFoundException(`Execution ${id} not found`);
    }

    const logs = await this.prisma.executionLog.findMany({
      where: { executionId: id },
      orderBy: { timestamp: "asc" },
    });

    return { ...execution, logs };
  }

  async findAllForWorkflow(workflowId: string): Promise<ExecutionRow[]> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    return this.prisma.execution.findMany({
      where: { workflowId },
      orderBy: { createdAt: "desc" },
    });
  }
}
