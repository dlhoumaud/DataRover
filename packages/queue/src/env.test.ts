import { describe, expect, it } from "vitest";
import { getRedisConnectionOptions } from "./env.js";

describe("getRedisConnectionOptions", () => {
  it("returns default host and port when nothing is provided", () => {
    const options = getRedisConnectionOptions({});
    expect(options).toEqual({ host: "localhost", port: 6379 });
  });

  it("does not include a password key when REDIS_PASSWORD is not set", () => {
    const options = getRedisConnectionOptions({});
    expect(options).not.toHaveProperty("password");
    expect(Object.keys(options).sort()).toEqual(["host", "port"]);
  });

  it("overrides the host from the provided env object", () => {
    const options = getRedisConnectionOptions({ REDIS_HOST: "redis.internal" });
    expect(options.host).toBe("redis.internal");
    expect(options.port).toBe(6379);
  });

  it("overrides the port from the provided env object", () => {
    const options = getRedisConnectionOptions({ REDIS_PORT: "6380" });
    expect(options.port).toBe(6380);
    expect(options.host).toBe("localhost");
  });

  it("overrides the password from the provided env object", () => {
    const options = getRedisConnectionOptions({ REDIS_PASSWORD: "s3cret" });
    expect(options.password).toBe("s3cret");
  });

  it("overrides host, port and password together", () => {
    const options = getRedisConnectionOptions({
      REDIS_HOST: "cache.example.com",
      REDIS_PORT: "16379",
      REDIS_PASSWORD: "hunter2",
    });
    expect(options).toEqual({
      host: "cache.example.com",
      port: 16379,
      password: "hunter2",
    });
  });

  it("does not mutate the global process.env by default", () => {
    const before = { ...process.env };
    getRedisConnectionOptions();
    expect(process.env).toEqual(before);
  });

  it("throws an explicit error when REDIS_PORT is not a valid integer", () => {
    expect(() => getRedisConnectionOptions({ REDIS_PORT: "not-a-number" })).toThrow(
      /Invalid REDIS_PORT/,
    );
  });

  it("throws an explicit error when REDIS_PORT is a float", () => {
    expect(() => getRedisConnectionOptions({ REDIS_PORT: "6379.5" })).toThrow(
      /Invalid REDIS_PORT/,
    );
  });

  it("throws an explicit error when REDIS_PORT is an empty-looking non-numeric string", () => {
    expect(() => getRedisConnectionOptions({ REDIS_PORT: "  " })).toThrow(
      /Invalid REDIS_PORT/,
    );
  });

  it("accepts a negative integer string for REDIS_PORT (parses, does not throw)", () => {
    expect(() => getRedisConnectionOptions({ REDIS_PORT: "-1" })).not.toThrow();
    expect(getRedisConnectionOptions({ REDIS_PORT: "-1" }).port).toBe(-1);
  });
});
