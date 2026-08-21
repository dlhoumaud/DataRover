-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('manual', 'interval', 'hourly', 'daily', 'weekly', 'cron');

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "type" "ScheduleType" NOT NULL,
    "everyMinutes" INTEGER,
    "cronExpression" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Schedule_workflowId_idx" ON "Schedule"("workflowId");

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
