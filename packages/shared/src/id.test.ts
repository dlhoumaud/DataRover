import { describe, expect, it } from "vitest";
import { generateId } from "./id.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("returns a bare UUID when no prefix is given", () => {
    const id = generateId();
    expect(id).toMatch(UUID_PATTERN);
  });

  it("prefixes the UUID with `${prefix}_` when a prefix is given", () => {
    const id = generateId("user");
    expect(id.startsWith("user_")).toBe(true);
    const uuidPart = id.slice("user_".length);
    expect(uuidPart).toMatch(UUID_PATTERN);
  });

  it("generates unique ids across many calls", () => {
    const count = 1000;
    const ids = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(count);
  });

  it("generates unique prefixed ids across many calls", () => {
    const count = 1000;
    const ids = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      ids.add(generateId("job"));
    }
    expect(ids.size).toBe(count);
  });
});
