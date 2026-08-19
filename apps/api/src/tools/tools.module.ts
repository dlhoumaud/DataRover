import { Module } from "@nestjs/common";
import { BrowserRendererService } from "./browser-renderer.service";
import { ToolsController } from "./tools.controller";
import { ToolsService } from "./tools.service";

@Module({
  controllers: [ToolsController],
  providers: [ToolsService, BrowserRendererService],
})
export class ToolsModule {}
