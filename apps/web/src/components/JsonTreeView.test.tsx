import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JsonTreeView } from "./JsonTreeView";

describe("JsonTreeView", () => {
  it("renders primitive leaves with their value", () => {
    render(<JsonTreeView value={{ name: "Produit A", price: 19.99, active: true, note: null }} onSelect={vi.fn()} />);
    expect(screen.getByText('"Produit A"')).toBeInTheDocument();
    expect(screen.getByText("19.99")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
  });

  it("expands array items by default a couple of levels deep, indexed numerically", () => {
    render(<JsonTreeView value={{ items: [{ price: 1 }, { price: 2 }] }} onSelect={vi.fn()} />);
    // depth 0 (root object), depth 1 ("items" array) and depth 1's entries (depth 2, the two
    // item objects) are auto-expanded (depth < 2) — their own children (depth 3, "price") are not.
    expect(screen.getAllByText("0")).not.toHaveLength(0);
    expect(screen.getAllByText("1")).not.toHaveLength(0);
  });

  it("calls onSelect with the clicked leaf's path and value", () => {
    const onSelect = vi.fn();
    render(<JsonTreeView value={{ price: 19.99 }} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("19.99"));
    expect(onSelect).toHaveBeenCalledWith(["price"], 19.99);
  });

  it("calls onSelect with the container's own path when clicking its key/bracket row", () => {
    const onSelect = vi.fn();
    const items = [{ price: 1 }];
    render(<JsonTreeView value={{ items }} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('"items"'));
    expect(onSelect).toHaveBeenCalledWith(["items"], items);
  });

  it("collapses a container on toggle click, hiding its children, and re-expands on a second click", () => {
    render(<JsonTreeView value={{ price: 19.99 }} onSelect={vi.fn()} />);
    expect(screen.getByText("19.99")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réduire" }));
    expect(screen.queryByText("19.99")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Développer" }));
    expect(screen.getByText("19.99")).toBeInTheDocument();
  });

  it("highlights the node whose path matches activePathKey", () => {
    render(<JsonTreeView value={{ price: 19.99 }} onSelect={vi.fn()} activePathKey="price" />);
    expect(screen.getByTestId("json-tree-leaf")).toHaveClass("bg-indigo-100");
  });
});
