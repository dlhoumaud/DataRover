import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.module";
import { ProjectsModule } from "./projects/projects.module";
import { WorkflowsModule } from "./workflows/workflows.module";
import { ExecutionsModule } from "./executions/executions.module";
import { SchedulesModule } from "./schedules/schedules.module";
import { HealthModule } from "./health/health.module";
import { ToolsModule } from "./tools/tools.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    QueueModule,
    SchedulesModule,
    ProjectsModule,
    WorkflowsModule,
    ExecutionsModule,
    HealthModule,
    ToolsModule,
  ],
})
export class AppModule {}
