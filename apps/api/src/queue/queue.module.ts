import { Global, Module } from "@nestjs/common";
import { ExecutionQueueService } from "./execution-queue.service";

/**
 * Global module so every feature module can inject `ExecutionQueueService`
 * without each of them having to re-import it explicitly.
 */
@Global()
@Module({
  providers: [ExecutionQueueService],
  exports: [ExecutionQueueService],
})
export class QueueModule {}
