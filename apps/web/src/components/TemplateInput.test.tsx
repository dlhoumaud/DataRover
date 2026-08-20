import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { TemplateInput } from "./TemplateInput";
import type { TemplateVariable } from "../lib/templateVariables";

const VARIABLES: TemplateVariable[] = [
  { path: "actions.http1.output.status", label: "actions.http1.output.status" },
  { path: "actions.http1.output.body", label: "actions.http1.output.body" },
  { path: "global.baseUrl", label: "global.baseUrl" },
];

/** A minimal real react-hook-form host, since `TemplateInput` takes a live `register(...)`
 *  return value — not something worth faking by hand. */
function Harness({ onSubmitValue, multiline = false }: { onSubmitValue: (value: string) => void; multiline?: boolean }): JSX.Element {
  const { register, watch } = useForm<{ field: string }>({ defaultValues: { field: "" } });
  const value = watch("field");
  onSubmitValue(value);
  return <TemplateInput registration={register("field")} variables={VARIABLES} multiline={multiline} className="field" />;
}

describe("TemplateInput", () => {
  it("shows every variable right after typing {{", () => {
    render(<Harness onSubmitValue={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "{{" } });
    (input as HTMLInputElement).setSelectionRange(2, 2);
    fireEvent.keyUp(input, { key: "{" });

    expect(screen.getByText("actions.http1.output.status")).toBeInTheDocument();
    expect(screen.getByText("global.baseUrl")).toBeInTheDocument();
  });

  it("filters suggestions by what's typed after {{", () => {
    render(<Harness onSubmitValue={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "{{ base" } });
    (input as HTMLInputElement).setSelectionRange(7, 7);
    fireEvent.keyUp(input, { key: "e" });

    expect(screen.getByText("global.baseUrl")).toBeInTheDocument();
    expect(screen.queryByText("actions.http1.output.status")).not.toBeInTheDocument();
  });

  it("closes the dropdown once the block is closed (a }} typed after the variable)", () => {
    render(<Harness onSubmitValue={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "{{ global.baseUrl }}" } });
    (input as HTMLInputElement).setSelectionRange(21, 21);
    fireEvent.keyUp(input, { key: "}" });

    expect(screen.queryByText("global.baseUrl")).not.toBeInTheDocument();
  });

  it("inserts the selected variable, wraps it in {{ }}, and updates the form value", () => {
    let latest = "";
    render(<Harness onSubmitValue={(value) => (latest = value)} />);
    const input = screen.getByRole("textbox");
    const value = "before {{ stat and after";
    const cursor = value.indexOf("stat") + "stat".length; // right after "stat", before the trailing space
    fireEvent.change(input, { target: { value } });
    (input as HTMLInputElement).setSelectionRange(cursor, cursor);
    fireEvent.keyUp(input, { key: "t" });

    fireEvent.mouseDown(screen.getByText("actions.http1.output.status"));

    expect(latest).toBe("before {{ actions.http1.output.status }} and after");
  });

  it("supports keyboard navigation (ArrowDown + Enter)", () => {
    let latest = "";
    render(<Harness onSubmitValue={(value) => (latest = value)} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "{{" } });
    (input as HTMLInputElement).setSelectionRange(2, 2);
    fireEvent.keyUp(input, { key: "{" });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(latest).toBe("{{ actions.http1.output.body }}");
  });

  it("closes on Escape without inserting anything", () => {
    render(<Harness onSubmitValue={vi.fn()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "{{" } });
    (input as HTMLInputElement).setSelectionRange(2, 2);
    fireEvent.keyUp(input, { key: "{" });
    expect(screen.getByText("global.baseUrl")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("global.baseUrl")).not.toBeInTheDocument();
  });

  it("works as a multiline textarea too", () => {
    render(<Harness onSubmitValue={vi.fn()} multiline />);
    const textarea = screen.getByRole("textbox");
    expect(textarea.tagName).toBe("TEXTAREA");
    fireEvent.change(textarea, { target: { value: "{{" } });
    (textarea as HTMLTextAreaElement).setSelectionRange(2, 2);
    fireEvent.keyUp(textarea, { key: "{" });
    expect(screen.getByText("global.baseUrl")).toBeInTheDocument();
  });
});
