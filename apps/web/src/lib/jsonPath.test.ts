import { describe, expect, it } from "vitest";
import { buildJsonPath } from "./jsonPath";

describe("buildJsonPath", () => {
  it("returns the root path for an empty segment list", () => {
    expect(buildJsonPath([])).toBe("$");
  });

  it("chains plain identifier keys with dots", () => {
    expect(buildJsonPath(["items", "price"])).toBe("$.items.price");
  });

  it("uses bracket notation for array indices", () => {
    expect(buildJsonPath(["items", 0, "price"])).toBe("$.items[0].price");
  });

  it("uses quoted bracket notation for a key that isn't a valid identifier", () => {
    expect(buildJsonPath(["a key with spaces"])).toBe('$["a key with spaces"]');
    expect(buildJsonPath(["attr_id"])).toBe("$.attr_id");
    expect(buildJsonPath(["data-testid"])).toBe('$["data-testid"]');
    expect(buildJsonPath(["1starts-with-digit"])).toBe('$["1starts-with-digit"]');
  });

  it("escapes a key containing a double quote", () => {
    expect(buildJsonPath(['say "hi"'])).toBe('$["say \\"hi\\""]');
  });

  it("mixes identifier, bracket-index, and quoted-bracket segments", () => {
    expect(buildJsonPath(["catalog", "product", 0, "attr id"])).toBe('$.catalog.product[0]["attr id"]');
  });
});
