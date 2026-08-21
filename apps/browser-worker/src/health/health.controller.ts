import { Controller, Get } from "@nestjs/common";
import { RenderService } from "../render/render.service";

export interface HealthResponse {
  status: "ok" | "degraded";
  chrome: "ok" | "missing";
}

/**
 * Liveness/readiness endpoint — mirrors apps/api's HealthController's shape, adapted to this
 * service's only real dependency: a usable Chrome/Chromium binary (see chromeBinary.ts). "missing"
 * is reported as `degraded` (200), not a 5xx: the process itself is up and would recover the
 * moment `CHROME_EXECUTABLE_PATH` or the container image is fixed, so a hard failure status would
 * be misleading for anything just checking "is this process alive".
 */
@Controller("health")
export class HealthController {
  constructor(private readonly renderService: RenderService) {}

  @Get()
  check(): HealthResponse {
    const chrome = this.renderService.hasChromeAvailable() ? "ok" : "missing";
    return { status: chrome === "ok" ? "ok" : "degraded", chrome };
  }
}
