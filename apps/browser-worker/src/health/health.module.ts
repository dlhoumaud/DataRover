import { Module } from "@nestjs/common";
import { RenderModule } from "../render/render.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [RenderModule],
  controllers: [HealthController],
})
export class HealthModule {}
