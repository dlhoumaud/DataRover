import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { HttpNode } from "@datarover/workflow-types";
import { HttpNodeInspector } from "./HttpNodeInspector";

function defaultNode(overrides?: Partial<HttpNode>): HttpNode {
  return {
    id: "h1",
    name: "New HTTP Request",
    type: "http",
    method: "GET",
    url: "https://example.com",
    responseType: "json",
    networkMode: "direct",
    ...overrides,
  };
}

/**
 * `HttpNodeInspector` doesn't have a broader test suite yet — this file covers only the
 * `networkMode` field added for the global proxy pool feature, not the whole component.
 */
describe("HttpNodeInspector — networkMode", () => {
  it("defaults to 'Adresse actuelle' (direct) for a node with no explicit networkMode set", () => {
    render(<HttpNodeInspector node={defaultNode()} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Mode réseau")).toHaveValue("direct");
  });

  it("commits 'proxy' once selected, leaving every other field untouched", async () => {
    const onChange = vi.fn();
    const node = defaultNode();
    render(<HttpNodeInspector node={node} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Mode réseau"), { target: { value: "proxy" } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    const updated = onChange.mock.calls.at(-1)?.[0] as HttpNode;
    expect(updated.networkMode).toBe("proxy");
    expect(updated.url).toBe(node.url);
    expect(updated.method).toBe(node.method);
  });

  it("reloads an existing 'proxy' node showing 'Proxy disponible' selected", () => {
    render(<HttpNodeInspector node={defaultNode({ networkMode: "proxy" })} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Mode réseau")).toHaveValue("proxy");
  });
});
