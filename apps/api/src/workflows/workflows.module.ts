import { Module } from "@nestjs/common";
import { SchedulesModule } from "../schedules/schedules.module";
import { WorkflowsController } from "./workflows.controller";
import { WorkflowsService } from "./workflows.service";

@Module({
  imports: [SchedulesModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
