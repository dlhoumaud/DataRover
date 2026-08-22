import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ProxyConfigPage } from "./ProxyConfigPage";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProxyConfigPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProxyConfigPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and displays the current purge threshold", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ purgeErrorThreshold: 5 }));
    renderPage();

    expect(await screen.findByDisplayValue("5")).toBeInTheDocument();
  });

  it("saves an updated threshold via PATCH", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ purgeErrorThreshold: 10 }));
      }
      return Promise.resolve(jsonResponse({ purgeErrorThreshold: 5 }));
    });
    renderPage();
    await screen.findByDisplayValue("5");

    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Enregistrer"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
      expect(patchCall).toBeDefined();
      expect(patchCall?.[0]).toBe("http://localhost:3001/proxies/config");
      expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({ purgeErrorThreshold: 10 });
    });
    expect(await screen.findByText("Enregistré.")).toBeInTheDocument();
  });
});
