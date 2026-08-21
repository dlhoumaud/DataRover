import { Module } from "@nestjs/common";
import { SessionController } from "./session.controller";
import { SessionService } from "./session.service";
import { SessionLiveGateway } from "./session-live.gateway";

@Module({
  controllers: [SessionController],
  providers: [SessionService, SessionLiveGateway],
})
export class SessionModule {}
