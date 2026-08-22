/**
 * Seeds a realistic example project on first setup, so a fresh clone shows something meaningful
 * the moment the UI is opened instead of an empty projects list.
 *
 * Runs automatically as part of `pnpm db:migrate` (Prisma's `prisma migrate dev` invokes the
 * script configured under the `"prisma".seed` key in package.json whenever it applies pending
 * migrations against the dev database) — see README.md "Installation". It intentionally does
 * NOT run on `prisma migrate deploy` (Prisma's own behavior): production/CI databases are never
 * auto-seeded. It can also be re-run any time with `pnpm db:seed`.
 *
 * Idempotent by design: every row uses a fixed, deterministic id (prefixed `seed-`) and is
 * created via `upsert` with an empty `update` — re-running this script (e.g. because a teammate
 * pulled a new migration and `migrate dev` re-triggered seeding) never creates duplicates, and
 * never overwrites changes a user made to the seeded project afterwards.
 *
 * Targets a real, stable public API (fakestoreapi.com) rather than a fixture only this process
 * can serve, so the example workflows stay genuinely runnable ("Exécuter" in the UI) long after
 * this script has finished.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { WorkflowDefinitionSchema, type WorkflowDefinition } from "@datarover/workflow-types";

const prisma = new PrismaClient();

const PROJECT_ID = "seed-veille-ecommerce";
const WORKFLOW_PRICE_ID = "seed-wf-price-monitor";
const WORKFLOW_QUALITY_ID = "seed-wf-quality-monitor";

/** Validates a definition against the same Zod schema the API uses before persisting it. */
function buildDefinition(input: unknown): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse(input);
}

const priceMonitorDefinition = buildDefinition({
  id: WORKFLOW_PRICE_ID,
  name: "Surveillance prix — Produit vedette",
  startNodeId: "fetchProduct",
  nodes: [
    {
      id: "fetchProduct",
      name: "Récupérer le produit",
      type: "http",
      method: "GET",
      url: "{{ global.apiBaseUrl }}/products/1",
      responseType: "json",
      timeoutMs: 10_000,
    },
    {
      id: "extractProduct",
      name: "Extraire prix, titre et note",
      type: "extract",
      source: "fetchProduct",
      sourceType: "json",
      rules: [
        { name: "title", strategy: "jsonpath", selectors: ["$.title"], output: "value" },
        { name: "price", strategy: "jsonpath", selectors: ["$.price"], output: "value" },
        { name: "rating", strategy: "jsonpath", selectors: ["$.rating.rate"], output: "value" },
      ],
    },
    {
      id: "prepareAlert",
      name: "Préparer le message d'alerte",
      type: "setVariable",
      variables: {
        alertMessage:
          "{{ actions.extractProduct.output.title }} est à {{ actions.extractProduct.output.price }} $ (note {{ actions.extractProduct.output.rating }}/5)",
      },
    },
    {
      id: "checkPrice",
      name: "Le prix est-il sous le seuil ?",
      type: "condition",
      expression: "actions.extractProduct.output.price < global.targetPrice",
    },
    {
      id: "priceAlert",
      name: "Notifier la baisse de prix",
      type: "stop",
      reason: "Prix sous le seuil cible — notification à envoyer (webhook/email en V2)",
    },
    {
      id: "priceStable",
      name: "Prix stable",
      type: "stop",
      reason: "Aucune alerte — prix au-dessus du seuil cible",
    },
  ],
  edges: [
    { from: "fetchProduct", to: "extractProduct" },
    { from: "extractProduct", to: "prepareAlert" },
    { from: "prepareAlert", to: "checkPrice" },
    { from: "checkPrice", to: "priceAlert", branch: "true" },
    { from: "checkPrice", to: "priceStable", branch: "false" },
  ],
});

const qualityMonitorDefinition = buildDefinition({
  id: WORKFLOW_QUALITY_ID,
  name: "Contrôle qualité — Notes produit",
  startNodeId: "fetchRatedProduct",
  nodes: [
    {
      id: "fetchRatedProduct",
      name: "Récupérer le produit",
      type: "http",
      method: "GET",
      url: "{{ global.apiBaseUrl }}/products/2",
      responseType: "json",
      timeoutMs: 10_000,
      retryPolicy: { maxAttempts: 3, backoffMs: 500, backoffMultiplier: 2 },
    },
    {
      id: "extractRating",
      name: "Extraire la note moyenne",
      type: "extract",
      source: "fetchRatedProduct",
      sourceType: "json",
      rules: [
        { name: "title", strategy: "jsonpath", selectors: ["$.title"], output: "value" },
        { name: "rating", strategy: "jsonpath", selectors: ["$.rating.rate"], output: "value" },
        { name: "reviewCount", strategy: "jsonpath", selectors: ["$.rating.count"], output: "value" },
      ],
    },
    {
      id: "checkQuality",
      name: "La note est-elle sous le seuil d'alerte ?",
      type: "condition",
      expression: "actions.extractRating.output.rating < global.alertThreshold",
    },
    {
      id: "qualityAlert",
      name: "Qualité insuffisante — à examiner",
      type: "stop",
      reason: "Note moyenne sous le seuil d'alerte",
    },
    {
      id: "qualityOk",
      name: "Qualité satisfaisante",
      type: "stop",
      reason: "Note moyenne au-dessus du seuil d'alerte",
    },
  ],
  edges: [
    { from: "fetchRatedProduct", to: "extractRating" },
    { from: "extractRating", to: "checkQuality" },
    { from: "checkQuality", to: "qualityAlert", branch: "true" },
    { from: "checkQuality", to: "qualityOk", branch: "false" },
  ],
});

async function upsertWorkflow(params: {
  workflowId: string;
  projectId: string;
  name: string;
  definition: WorkflowDefinition;
}): Promise<void> {
  await prisma.workflow.upsert({
    where: { id: params.workflowId },
    update: {},
    create: { id: params.workflowId, projectId: params.projectId, name: params.name },
  });

  await prisma.workflowVersion.upsert({
    where: { id: `${params.workflowId}-v1` },
    update: {},
    create: {
      id: `${params.workflowId}-v1`,
      workflowId: params.workflowId,
      version: 1,
      definition: params.definition as unknown as Prisma.InputJsonValue,
    },
  });
}

async function main(): Promise<void> {
  await prisma.project.upsert({
    where: { id: PROJECT_ID },
    update: {},
    create: {
      id: PROJECT_ID,
      name: "Veille e-commerce",
      description:
        "Surveillance de prix et de qualité produit sur une API e-commerce publique " +
        "(fakestoreapi.com), fournie comme exemple réaliste prêt à l'emploi.",
      variables: { apiBaseUrl: "https://fakestoreapi.com", targetPrice: 50, alertThreshold: 4 },
    },
  });

  await upsertWorkflow({
    workflowId: WORKFLOW_PRICE_ID,
    projectId: PROJECT_ID,
    name: "Surveillance prix — Produit vedette",
    definition: priceMonitorDefinition,
  });

  await upsertWorkflow({
    workflowId: WORKFLOW_QUALITY_ID,
    projectId: PROJECT_ID,
    name: "Contrôle qualité — Notes produit",
    definition: qualityMonitorDefinition,
  });

  // Fixed id "singleton" — the whole point of this row (see schema.prisma's doc comment) is that
  // there is only ever one. `update: {}` here matters even more than for the other seeds above:
  // it must never reset a threshold an admin already changed via the config page back to 5.
  await prisma.proxyPoolConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", purgeErrorThreshold: 5 },
  });

  console.log('Seed OK — projet "Veille e-commerce" (2 workflows) prêt.');
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
