import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

interface ProxyResponse {
  id: string;
  host: string;
  port: number;
  status: "active" | "disabled";
  errorCount: number;
  isInUse: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ProxyListResponse {
  items: ProxyResponse[];
  total: number;
  page: number;
  limit: number;
}

interface ProxyConfigResponse {
  purgeErrorThreshold: number;
}

describe("Proxies", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const createdProxyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    prisma = app.get(PrismaService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    while (createdProxyIds.length > 0) {
      const id = createdProxyIds.pop();
      if (id) {
        await prisma.proxy.deleteMany({ where: { id } });
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProxy(host: string, port = 8080): Promise<ProxyResponse> {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/proxies",
      payload: { host, port },
    });
    expect(response.statusCode).toBe(201);
    const proxy = JSON.parse(response.payload) as ProxyResponse;
    createdProxyIds.push(proxy.id);
    return proxy;
  }

  it("supports the full create/list/get/update/delete cycle", async () => {
    const host = `e2e-proxy-${randomUUID()}.example`;
    const created = await createProxy(host, 3128);
    expect(created).toMatchObject({ host, port: 3128, status: "active", errorCount: 0, isInUse: false });

    const getResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/proxies/${created.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    expect((JSON.parse(getResponse.payload) as ProxyResponse).id).toBe(created.id);

    const listResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/proxies",
    });
    expect(listResponse.statusCode).toBe(200);
    const list = JSON.parse(listResponse.payload) as ProxyListResponse;
    expect(list.items.some((p) => p.id === created.id)).toBe(true);

    const updateResponse = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/proxies/${created.id}`,
      payload: { status: "disabled" },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect((JSON.parse(updateResponse.payload) as ProxyResponse).status).toBe("disabled");

    const deleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: `/proxies/${created.id}`,
    });
    expect(deleteResponse.statusCode).toBe(204);

    const getAfterDeleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/proxies/${created.id}`,
    });
    expect(getAfterDeleteResponse.statusCode).toBe(404);
    createdProxyIds.pop(); // already gone — nothing left for afterEach to clean up
  });

  it("returns 404 for a non-existent proxy id", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/proxies/does-not-exist",
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for an invalid create payload (missing port)", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/proxies",
      payload: { host: "1.2.3.4" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects creating a duplicate host+port with 409, not a raw 500", async () => {
    const host = `e2e-proxy-dup-${randomUUID()}.example`;
    await createProxy(host, 8080);

    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/proxies",
      payload: { host, port: 8080 },
    });
    expect(response.statusCode).toBe(409);
  });

  it("rejects renaming a proxy onto an already-taken host+port, but allows renaming onto its own", async () => {
    const hostA = `e2e-proxy-a-${randomUUID()}.example`;
    const hostB = `e2e-proxy-b-${randomUUID()}.example`;
    const proxyA = await createProxy(hostA, 8080);
    await createProxy(hostB, 9090);

    const collision = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/proxies/${proxyA.id}`,
      payload: { host: hostB, port: 9090 },
    });
    expect(collision.statusCode).toBe(409);

    // Same host+port it already has — must NOT be treated as a collision with itself.
    const noop = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/proxies/${proxyA.id}`,
      payload: { host: hostA, port: 8080 },
    });
    expect(noop.statusCode).toBe(200);
  });

  it("filters by status and paginates without repeating or dropping rows across pages", async () => {
    const marker = randomUUID();
    for (let i = 0; i < 3; i++) {
      await createProxy(`e2e-proxy-page-${marker}-${i}.example`, 8000 + i);
    }
    const disabledHost = `e2e-proxy-disabled-${marker}.example`;
    const disabled = await createProxy(disabledHost, 7000);
    await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/proxies/${disabled.id}`,
      payload: { status: "disabled" },
    });

    const activeOnly = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/proxies?status=active&limit=100",
    });
    const activeList = JSON.parse(activeOnly.payload) as ProxyListResponse;
    expect(activeList.items.some((p) => p.host === disabledHost)).toBe(false);
    expect(activeList.items.filter((p) => p.host.includes(marker)).length).toBe(3);

    const page1 = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/proxies?limit=2&page=1",
    });
    const page2 = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/proxies?limit=2&page=2",
    });
    const list1 = JSON.parse(page1.payload) as ProxyListResponse;
    const list2 = JSON.parse(page2.payload) as ProxyListResponse;
    expect(list1.items).toHaveLength(2);
    expect(list1.total).toBe(list2.total);
    const idsOnPage1 = new Set(list1.items.map((p) => p.id));
    expect(list2.items.some((p) => idsOnPage1.has(p.id))).toBe(false);
  });

  it("gets the default config and lets it be updated", async () => {
    const getResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/proxies/config",
    });
    expect(getResponse.statusCode).toBe(200);
    expect(typeof (JSON.parse(getResponse.payload) as ProxyConfigResponse).purgeErrorThreshold).toBe("number");

    const updateResponse = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: "/proxies/config",
      payload: { purgeErrorThreshold: 7 },
    });
    expect(updateResponse.statusCode).toBe(200);
    expect((JSON.parse(updateResponse.payload) as ProxyConfigResponse).purgeErrorThreshold).toBe(7);

    // Restore the default so this test is safe to re-run and doesn't leak into other suites/the
    // live app's own config.
    await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: "/proxies/config",
      payload: { purgeErrorThreshold: 5 },
    });
  });
});
