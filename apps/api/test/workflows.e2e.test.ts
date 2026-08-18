import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

interface WorkflowDetailResponse {
  id: string;
  projectId: string;
  name: string;
  currentVersion: {
    version: number;
    definition: unknown;
    createdAt: string;
  };
}

interface WorkflowSummaryResponse {
  id: string;
  name: string;
  latestVersion: number;
}

function stopOnlyDefinition(name: string) {
  return {
    name,
    startNodeId: "stop-1",
    nodes: [{ id: "stop-1", name: "Stop", type: "stop" as const }],
    edges: [],
  };
}

describe("Workflows", () => {
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

  async function createProject(): Promise<string> {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/projects",
      payload: { name: `e2e-workflow-project-${randomUUID()}` },
    });
    const body = JSON.parse(response.payload) as { id: string };
    createdProjectIds.push(body.id);
    return body.id;
  }

  it("creates a workflow with version 1, then a new version on update", async () => {
    const projectId = await createProject();

    const createResponse = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/projects/${projectId}/workflows`,
      payload: {
        name: "Stop workflow",
        definition: stopOnlyDefinition("Stop workflow"),
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.payload) as WorkflowDetailResponse;
    expect(created.currentVersion.version).toBe(1);
    expect(created.projectId).toBe(projectId);

    const getResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/workflows/${created.id}`,
    });
    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.payload) as WorkflowDetailResponse;
    expect(fetched.currentVersion.version).toBe(1);

    const listResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/projects/${projectId}/workflows`,
    });
    expect(listResponse.statusCode).toBe(200);
    const list = JSON.parse(listResponse.payload) as WorkflowSummaryResponse[];
    const summary = list.find((workflow) => workflow.id === created.id);
    expect(summary?.latestVersion).toBe(1);

    const updateResponse = await app.getHttpAdapter().getInstance().inject({
      method: "PATCH",
      url: `/workflows/${created.id}`,
      payload: {
        definition: stopOnlyDefinition("Stop workflow v2"),
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = JSON.parse(updateResponse.payload) as WorkflowDetailResponse;
    expect(updated.currentVersion.version).toBe(2);

    const listAfterUpdateResponse = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/projects/${projectId}/workflows`,
    });
    const listAfterUpdate = JSON.parse(
      listAfterUpdateResponse.payload,
    ) as WorkflowSummaryResponse[];
    const summaryAfterUpdate = listAfterUpdate.find((workflow) => workflow.id === created.id);
    expect(summaryAfterUpdate?.latestVersion).toBe(2);

    const deleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: `/workflows/${created.id}`,
    });
    expect(deleteResponse.statusCode).toBe(204);
  });

  it("returns 404 for a non-existent workflow id", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/workflows/does-not-exist",
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns 404 when creating a workflow under a non-existent project", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/projects/does-not-exist/workflows",
      payload: {
        name: "orphan workflow",
        definition: stopOnlyDefinition("orphan workflow"),
      },
    });
    expect(response.statusCode).toBe(404);
  });
});
