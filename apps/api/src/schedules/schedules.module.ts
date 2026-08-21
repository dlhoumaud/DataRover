import { Module } from "@nestjs/common";
import { SchedulesController } from "./schedules.controller";
import { SchedulesService } from "./schedules.service";
import { ScheduleQueueService } from "./schedule-queue.service";

/**
 * Exports `SchedulesService` (not just for its own controller) so `WorkflowsModule`/
 * `ProjectsModule` can call `removeAllJobSchedulersFor{Workflow,Project}` before deleting rows
 * that would otherwise cascade away `Schedule` rows out from under a still-registered BullMQ job
 * scheduler — see that method's doc comment.
 */
@Module({
  controllers: [SchedulesController],
  providers: [SchedulesService, ScheduleQueueService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
