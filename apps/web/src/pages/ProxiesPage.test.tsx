import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ProxyDto } from "../api/types";
import { ProxiesPage } from "./ProxiesPage";

function proxy(overrides: Partial<ProxyDto> = {}): ProxyDto {
  return {
    id: "proxy1",
    host: "10.0.0.1",
    port: 8080,
    status: "active",
    errorCount: 0,
    isInUse: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProxiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProxiesPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists the fetched proxies with their status/error count/usage", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [proxy(), proxy({ id: "proxy2", host: "10.0.0.2", status: "disabled", errorCount: 3, isInUse: true })], total: 2, page: 1, limit: 20 }),
    );

    renderPage();

    expect(await screen.findByText("10.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2")).toBeInTheDocument();
    // Scoped to the table: "Actif"/"Désactivé" also appear as <option>s in the status filter.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Actif")).toBeInTheDocument();
    expect(table.getByText("Désactivé")).toBeInTheDocument();
    expect(table.getByText("3")).toBeInTheDocument();
    expect(table.getByText("Oui")).toBeInTheDocument();
  });

  it("requests the next page with an incremented page number when 'Suivant' is clicked", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [proxy()], total: 45, page: 1, limit: 20 }));
    renderPage();

    await screen.findByText("10.0.0.1");
    expect(screen.getByText("Page 1 / 3 (45 proxys)")).toBeInTheDocument();
    expect(screen.getByText("Précédent")).toBeDisabled();

    fireEvent.click(screen.getByText("Suivant"));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1) as [string, unknown];
      expect(lastCall[0]).toContain("page=2");
    });
  });

  it("resets to page 1 and includes the status filter when it changes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [proxy()], total: 1, page: 1, limit: 20 }));
    renderPage();
    await screen.findByText("10.0.0.1");

    fireEvent.change(screen.getByDisplayValue("Tous"), { target: { value: "disabled" } });

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1) as [string, unknown];
      expect(lastCall[0]).toContain("status=disabled");
      expect(lastCall[0]).toContain("page=1");
    });
  });

  it("creates a proxy via the inline form and refreshes the list", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse(proxy({ id: "proxy2", host: "10.0.0.9", port: 3128 }), 201));
      }
      return Promise.resolve(jsonResponse({ items: [proxy()], total: 1, page: 1, limit: 20 }));
    });
    renderPage();
    await screen.findByText("10.0.0.1");

    fireEvent.click(screen.getByText("Nouveau proxy"));
    fireEvent.change(screen.getByPlaceholderText("192.168.1.10"), { target: { value: "10.0.0.9" } });
    fireEvent.change(screen.getByPlaceholderText("8080"), { target: { value: "3128" } });
    fireEvent.click(screen.getByText("Ajouter"));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "POST");
      expect(postCall).toBeDefined();
      expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({ host: "10.0.0.9", port: 3128 });
    });
  });

  it("toggles a proxy's status via PATCH", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Promise.resolve(jsonResponse(proxy({ status: "disabled" })));
      }
      return Promise.resolve(jsonResponse({ items: [proxy()], total: 1, page: 1, limit: 20 }));
    });
    renderPage();
    await screen.findByText("10.0.0.1");

    fireEvent.click(screen.getByText("Désactiver"));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
      expect(patchCall).toBeDefined();
      expect(patchCall?.[0]).toContain("/proxies/proxy1");
      expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({ status: "disabled" });
    });
  });

  it("deletes a proxy after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse({ items: [proxy()], total: 1, page: 1, limit: 20 }));
    });
    renderPage();
    await screen.findByText("10.0.0.1");

    fireEvent.click(screen.getByText("Supprimer"));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === "DELETE");
      expect(deleteCall).toBeDefined();
      expect(deleteCall?.[0]).toContain("/proxies/proxy1");
    });
  });

  it("does not delete when the confirmation dialog is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fetchMock.mockResolvedValue(jsonResponse({ items: [proxy()], total: 1, page: 1, limit: 20 }));
    renderPage();
    await screen.findByText("10.0.0.1");

    fireEvent.click(screen.getByText("Supprimer"));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
  });
});
