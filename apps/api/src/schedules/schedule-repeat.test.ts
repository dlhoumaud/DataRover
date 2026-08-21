import { describe, expect, it } from "vitest";
import { scheduleToRepeatOptions } from "./schedule-repeat";

describe("scheduleToRepeatOptions", () => {
  it("returns null for a manual schedule — never fires automatically", () => {
    expect(scheduleToRepeatOptions({ type: "manual", everyMinutes: null, cronExpression: null })).toBeNull();
  });

  it("converts everyMinutes to milliseconds for an interval schedule", () => {
    expect(scheduleToRepeatOptions({ type: "interval", everyMinutes: 15, cronExpression: null })).toEqual({
      every: 900_000,
    });
  });

  it("throws when an interval schedule has no everyMinutes", () => {
    expect(() =>
      scheduleToRepeatOptions({ type: "interval", everyMinutes: null, cronExpression: null }),
    ).toThrow(/everyMinutes/);
  });

  it("resolves hourly/daily/weekly to fixed, wall-clock-aligned cron patterns", () => {
    expect(scheduleToRepeatOptions({ type: "hourly", everyMinutes: null, cronExpression: null })).toEqual({
      pattern: "0 * * * *",
    });
    expect(scheduleToRepeatOptions({ type: "daily", everyMinutes: null, cronExpression: null })).toEqual({
      pattern: "0 0 * * *",
    });
    expect(scheduleToRepeatOptions({ type: "weekly", everyMinutes: null, cronExpression: null })).toEqual({
      pattern: "0 0 * * 0",
    });
  });

  it("passes a cron schedule's own expression through as the pattern", () => {
    expect(
      scheduleToRepeatOptions({ type: "cron", everyMinutes: null, cronExpression: "*/5 * * * *" }),
    ).toEqual({ pattern: "*/5 * * * *" });
  });

  it("throws when a cron schedule has no cronExpression", () => {
    expect(() => scheduleToRepeatOptions({ type: "cron", everyMinutes: null, cronExpression: null })).toThrow(
      /cronExpression/,
    );
  });
});
