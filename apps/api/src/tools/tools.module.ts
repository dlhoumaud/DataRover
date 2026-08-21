import { Module } from "@nestjs/common";
import { BrowserWorkerClient } from "./browser-worker.client";
import { ToolsController } from "./tools.controller";
import { ToolsService } from "./tools.service";
import { SessionLiveProxyGateway } from "./session-live.gateway";

@Module({
  controllers: [ToolsController],
  providers: [ToolsService, BrowserWorkerClient, SessionLiveProxyGateway],
})
export class ToolsModule {}
