import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller";
import type { RenderService } from "../render/render.service";

function buildController(hasChromeAvailable: boolean): HealthController {
  const renderService = { hasChromeAvailable: () => hasChromeAvailable } as unknown as RenderService;
  return new HealthController(renderService);
}

describe("HealthController", () => {
  it('reports "ok" when a Chrome/Chromium binary is available', () => {
    expect(buildController(true).check()).toEqual({ status: "ok", chrome: "ok" });
  });

  it('reports "degraded" (not a failure) when no Chrome/Chromium binary is available', () => {
    expect(buildController(false).check()).toEqual({ status: "degraded", chrome: "missing" });
  });
});
