import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleLogger } from "./logger.js";

const TIMESTAMP_PATTERN = /^\[\d{2}:\d{2}:\d{2}\] /;

describe("createConsoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info messages to console.log with the logger name and message", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createConsoleLogger("my-service");

    logger.info("hello world");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[my-service]");
    expect(line).toContain("hello world");
    expect(line).toMatch(TIMESTAMP_PATTERN);
    expect(line).not.toContain("INFO");
  });

  it("writes debug messages to console.log without a level prefix", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createConsoleLogger("my-service");

    logger.debug("debugging details");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[my-service]");
    expect(line).toContain("debugging details");
    expect(line).toMatch(TIMESTAMP_PATTERN);
    expect(line).not.toContain("DEBUG");
  });

  it("writes warn messages to console.warn with an uppercase WARN prefix", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createConsoleLogger("my-service");

    logger.warn("careful now");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[my-service]");
    expect(line).toContain("careful now");
    expect(line).toContain("WARN");
    expect(line).toMatch(TIMESTAMP_PATTERN);
  });

  it("writes error messages to console.error with an uppercase ERROR prefix", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConsoleLogger("my-service");

    logger.error("boom");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain("[my-service]");
    expect(line).toContain("boom");
    expect(line).toContain("ERROR");
    expect(line).toMatch(TIMESTAMP_PATTERN);
  });

  it("does not call other console methods for a given level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConsoleLogger("svc");

    logger.info("x");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
