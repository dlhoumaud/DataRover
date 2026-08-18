import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

interface ProjectResponse {
  id: string;
  name: string;
  description?: string | null;
  variables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

describe("Projects", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    prisma = app.get(PrismaService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    // Cascade delete on Project wipes any Workflow/WorkflowVersion/Execution
    // that a test created downstream of it.
    while (createdProjectIds.length > 0) {
      const id = createdProjectIds.pop();
      if (id) {
        await prisma.project.deleteMany({ where: { id } });
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("supports the full create/list/get/update/delete cycle", async () => {
    const projectName = `e2e-project-${randomUUID()}`;

    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/projects",
      payload: { name: projectName, description: "e2e test project" },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.payload) as ProjectResponse;
    createdProjectIds.push(created.id);
    expect(created.name).toBe(projectName);
    expect(created.description).toBe("e2e test project");

    const listResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/projects",
    });
    expect(listResponse.statusCode).toBe(200);
    const list = JSON.parse(listResponse.payload) as ProjectResponse[];
    expect(list.some((project) => project.id === created.id)).toBe(true);

    const getResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/projects/${created.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.payload) as ProjectResponse;
    expect(fetched.id).toBe(created.id);

    const updateResponse = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/projects/${created.id}`,
      payload: { description: "updated description" },
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = JSON.parse(updateResponse.payload) as ProjectResponse;
    expect(updated.description).toBe("updated description");
    expect(updated.name).toBe(projectName);

    const deleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: `/projects/${created.id}`,
    });
    expect(deleteResponse.statusCode).toBe(204);

    const getAfterDeleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/projects/${created.id}`,
    });
    expect(getAfterDeleteResponse.statusCode).toBe(404);
  });

  it("returns 404 for a non-existent project id", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/projects/does-not-exist",
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 400 for an invalid create payload (missing name)", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/projects",
      payload: { description: "missing name" },
    });
    expect(response.statusCode).toBe(400);
  });
});
