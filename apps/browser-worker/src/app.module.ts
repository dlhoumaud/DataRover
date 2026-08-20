import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RenderModule } from "./render/render.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RenderModule, HealthModule],
})
export class AppModule {}
