import { describe, expect, it } from "vitest";
import { candidateSelectors } from "./candidateSelectors";

function parse(html: string): Element {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.body.firstElementChild;
  if (!el) {
    throw new Error("Fixture HTML produced no element");
  }
  return el;
}

describe("candidateSelectors", () => {
  it("prefers a non-numeric id", () => {
    const el = parse('<button id="submit-button">Go</button>');
    expect(candidateSelectors(el)[0]).toBe("#submit-button");
  });

  it("skips a numeric-leading id (not a valid CSS identifier start)", () => {
    const el = parse('<div id="42-widget" class="widget">x</div>');
    expect(candidateSelectors(el)).not.toContain("#42-widget");
  });

  it("proposes every data-* attribute", () => {
    const el = parse('<div data-testid="price" data-role="value">10€</div>');
    const candidates = candidateSelectors(el);
    expect(candidates).toContain('[data-testid="price"]');
    expect(candidates).toContain('[data-role="value"]');
  });

  it("proposes clean own classes but not hash-looking ones", () => {
    const el = parse('<span class="price highlighted">10€</span>');
    expect(candidateSelectors(el)).toContain(".price.highlighted");
  });

  it("still proposes the raw class list when every class looks hashed", () => {
    const el = parse('<div class="a3f92x1 css-8f8f8f">content</div>');
    const candidates = candidateSelectors(el);
    expect(candidates.some((c) => c.includes("a3f92x1"))).toBe(true);
  });

  it("combines parent + own class when both exist", () => {
    const el = parse('<div class="card"><span class="title">Name</span></div>').querySelector("span");
    expect(el).not.toBeNull();
    const candidates = candidateSelectors(el as Element);
    expect(candidates).toContain(".card .title");
  });

  it("falls back to an anchored positional path with no id/class anywhere up the tree", () => {
    // Climbs all the way to <body> (itself id/class-less here) before the loop's own "stop at
    // <html>" condition kicks in — see anchoredPathSelector's doc comment.
    const el = parse("<p>hello</p>");
    const candidates = candidateSelectors(el);
    expect(candidates.at(-1)).toBe("body > p");
  });

  it("de-duplicates identical candidates", () => {
    const el = parse('<div id="x" class="x">y</div>'); // id "x" and a class also named "x"
    const candidates = candidateSelectors(el);
    expect(candidates.length).toBe(new Set(candidates).size);
  });

  it("survives a Function.prototype.toString() round trip — the whole reason it's written as one self-contained function", () => {
    // This is the exact trick both real call sites rely on (Playwright's addInitScript
    // serialization, and htmlSandbox.ts's own `${candidateSelectors.toString()}` embedding) —
    // reproduced literally here rather than trusted on faith.
    const roundTripped = new Function(`return (${candidateSelectors.toString()})`)() as typeof candidateSelectors;
    const el = parse('<button id="go">Go</button>');
    expect(roundTripped(el)).toEqual(candidateSelectors(el));
  });
});
