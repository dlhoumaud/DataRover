import { describe, expect, it } from "vitest";
import { buildSandboxedDocument, isElementSelectedMessage } from "./htmlSandbox";

describe("buildSandboxedDocument", () => {
  it("strips every <script> element from the fetched page", () => {
    const html = `<html><body><script>window.alert("evil")</script><p>Hello</p></body></html>`;
    const output = buildSandboxedDocument(html, "https://example.com/");
    // The one <script> that survives must be ours (identified by its
    // marker string), never the page's original inline script.
    expect(output).not.toContain("evil");
    expect(output).toContain("datarover-html-preview");
  });

  it("removes inline event-handler attributes", () => {
    const html = `<html><body><button onclick="doEvil()">Click</button></body></html>`;
    const output = buildSandboxedDocument(html, "https://example.com/");
    expect(output).not.toContain("onclick");
    expect(output).not.toContain("doEvil");
  });

  it("removes javascript: URLs from href/src attributes", () => {
    const html = `<html><body><a href="javascript:doEvil()">link</a><img src="javascript:doEvil()" /></body></html>`;
    const output = buildSandboxedDocument(html, "https://example.com/");
    expect(output).not.toContain("javascript:");
    expect(output).not.toContain("doEvil");
  });

  it("strips a meta refresh tag so the preview can't auto-navigate", () => {
    const html = `<html><head><meta http-equiv="refresh" content="0;url=https://evil.example.com" /></head><body></body></html>`;
    const output = buildSandboxedDocument(html, "https://example.com/");
    expect(output.toLowerCase()).not.toContain("refresh");
  });

  it("injects a <base> tag pointing at the real page URL, replacing any existing one", () => {
    const html = `<html><head><base href="https://old.example.com/" /></head><body><img src="/logo.png" /></body></html>`;
    const output = buildSandboxedDocument(html, "https://real-site.example.com/catalog");
    expect(output).toContain('<base href="https://real-site.example.com/catalog">');
    expect(output).not.toContain("old.example.com");
  });

  it("omits the <base> tag entirely when no baseUrl is provided", () => {
    const html = `<html><head></head><body></body></html>`;
    const output = buildSandboxedDocument(html, undefined);
    expect(output).not.toContain("<base");
  });

  it("preserves ordinary content and structure", () => {
    const html = `<html><body><div class="product-card"><span class="title">Produit A</span></div></body></html>`;
    const output = buildSandboxedDocument(html, "https://example.com/");
    expect(output).toContain("product-card");
    expect(output).toContain("Produit A");
  });

  it("rewrites a relative <img src> through the asset proxy, resolved against baseUrl", () => {
    const html = `<html><body><img src="/media/photo.jpg" /></body></html>`;
    const output = buildSandboxedDocument(html, "https://shop.example.com/catalog");
    expect(output).toContain(
      '/tools/preview-asset?url=' + encodeURIComponent("https://shop.example.com/media/photo.jpg"),
    );
    expect(output).not.toContain('src="/media/photo.jpg"');
  });

  it("rewrites an already-absolute <img src> through the asset proxy too", () => {
    const html = `<html><body><img src="https://cdn.example.com/photo.jpg" /></body></html>`;
    const output = buildSandboxedDocument(html, "https://shop.example.com/catalog");
    expect(output).toContain(
      '/tools/preview-asset?url=' + encodeURIComponent("https://cdn.example.com/photo.jpg"),
    );
  });

  it("rewrites every URL candidate inside a srcset, preserving descriptors", () => {
    const html = `<html><body><img src="/a.jpg" srcset="/a-320.jpg 320w, /a-640.jpg 640w" /></body></html>`;
    const output = buildSandboxedDocument(html, "https://shop.example.com/");
    const proxied320 = encodeURIComponent("https://shop.example.com/a-320.jpg");
    const proxied640 = encodeURIComponent("https://shop.example.com/a-640.jpg");
    expect(output).toContain(`preview-asset?url=${proxied320} 320w`);
    expect(output).toContain(`preview-asset?url=${proxied640} 640w`);
  });

  it("leaves <img src> untouched when no baseUrl is available to resolve it against", () => {
    const html = `<html><body><img src="/media/photo.jpg" /></body></html>`;
    const output = buildSandboxedDocument(html, undefined);
    expect(output).toContain('src="/media/photo.jpg"');
    expect(output).not.toContain("preview-asset");
  });
});

describe("isElementSelectedMessage", () => {
  it("accepts a well-formed message", () => {
    expect(
      isElementSelectedMessage({
        source: "datarover-html-preview",
        type: "element-selected",
        selectors: [".title"],
        tagName: "span",
        textPreview: "Produit A",
      }),
    ).toBe(true);
  });

  it("rejects unrelated messages (e.g. from other postMessage senders)", () => {
    expect(isElementSelectedMessage({ source: "react-devtools", type: "hello" })).toBe(false);
    expect(isElementSelectedMessage("not an object")).toBe(false);
    expect(isElementSelectedMessage(null)).toBe(false);
  });
});
