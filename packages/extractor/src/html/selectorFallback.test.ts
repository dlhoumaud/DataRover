import { describe, expect, it } from "vitest";
import { scoreSelector } from "./selectorFallback.js";

describe("scoreSelector", () => {
  it("scores a data-testid attribute selector higher than a fragile nth-child chain", () => {
    const stableScore = scoreSelector('[data-testid="price"]');
    const fragileScore = scoreSelector(
      "div > div:nth-child(4) > span:nth-child(2)",
    );

    expect(stableScore).toBeGreaterThan(fragileScore);
  });

  it("gives a data-testid selector a high score", () => {
    expect(scoreSelector('[data-testid="price"]')).toBe(40);
  });

  it("gives a generic data-* attribute selector a bonus", () => {
    expect(scoreSelector('[data-price="value"]')).toBe(40);
  });

  it("gives an id selector a bonus", () => {
    expect(scoreSelector("#price")).toBe(25);
  });

  it("gives a stable class selector a bonus", () => {
    expect(scoreSelector(".product-price")).toBe(15);
  });

  it("penalizes nth-child usage", () => {
    expect(scoreSelector("span:nth-child(2)")).toBe(0);
  });

  it("penalizes nth-of-type usage", () => {
    expect(scoreSelector("span:nth-of-type(2)")).toBe(0);
  });

  it("does not grant the class bonus when nth-child is present", () => {
    const withNth = scoreSelector(".price:nth-child(2)");
    const withoutNth = scoreSelector(".price");
    expect(withNth).toBeLessThan(withoutNth);
  });

  it("penalizes long combinator chains beyond the first combinator", () => {
    const single = scoreSelector(".card .price");
    const long = scoreSelector(".card > .row > .cell .price");
    expect(long).toBeLessThan(single);
  });

  it("does not penalize a single combinator", () => {
    expect(scoreSelector(".card .price")).toBe(15 - 0);
  });

  it("clamps the score at 0 for a heavily fragile selector", () => {
    const score = scoreSelector(
      "body > div > div > div:nth-child(3) > div:nth-child(4) > span:nth-child(2)",
    );
    expect(score).toBe(0);
  });

  it("stacks compatible bonuses (data attribute + id + class) without exceeding 100", () => {
    const score = scoreSelector('#price[data-testid="price"].stable-class');
    expect(score).toBe(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("does not count whitespace inside attribute selector values as a combinator", () => {
    const score = scoreSelector('[data-testid="add to cart"]');
    expect(score).toBe(40);
  });
});
