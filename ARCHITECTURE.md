# Architecture — état d'avancement

Ce document indique ce qui est **réellement implémenté** dans ce dépôt, par opposition à ce que
décrit [`Specs.md`](./Specs.md) (le cahier des charges complet du produit cible). Il est mis à
jour à chaque itération.

> Principe directeur (Specs.md, section 27/28) : *« Construire d'abord un moteur de workflow
> fiable et un modèle de données propre. L'éditeur visuel vient représenter ce moteur, il ne doit
> pas le définir. »*

## Itération 1 — Fondations + moteur de workflow (livrée)

Un monorepo Turborepo/pnpm avec 5 packages purs TypeScript, sans API, sans UI, sans Docker :

| Package | Rôle | Sections Specs.md |
|---|---|---|
| `packages/shared` | `generateId`, `sleep`, `Logger`/`createConsoleLogger` | — (utilitaire transverse) |
| `packages/workflow-types` | Modèle métier Zod + types TS : `Project`, `Variable` (scopes global/project/workflow/action/iteration/runtime), `ActionNode` (union discriminée `http`/`extract`/`condition`/`setVariable`/`stop`), `WorkflowDefinition` (nodes+edges), `Execution`/`ExecutionLog`/`ExecutionStatus`, `Schedule` | §9, §12, §14, §16 |
| `packages/expression-engine` | Interpolation `{{ }}` et évaluateur d'expressions **maison** (tokenizer/parser/evaluator, aucun `eval`/`new Function`) pour les conditions IF | §7 (« Expression JavaScript contrôlée »), §12, §13 |
| `packages/extractor` | Extraction CSS (Cheerio, fallback multi-sélecteurs + score de robustesse), JSONPath, XML→JSON, Regex | §7, §8, §17.8, §17.10, §17.11 |
| `packages/workflow-core` | Le moteur : `WorkflowEngine.run(definition, options)` — parcours du graphe nodes/edges, 5 exécuteurs par défaut (`http` via Undici, `extract`, `condition`, `setVariable`, `stop`), retry policy + timeout génériques, événements de cycle de vie (`onEvent`) | §9, §16, §17.7 |
| `examples/product-monitor` | Script exécutable rejouant le scénario "Surveillance catalogue" (§3) dans les limites du MVP : `GET → Extract (liste) → IF → Stop` | §3, §6, §15 |

Le modèle `WorkflowDefinition` utilise volontairement `nodes` + `edges` (pas de pointeurs `next`
imbriqués) : c'est le modèle natif de React Flow, donc le futur éditeur visuel (§10, §17.2) pourra
se brancher directement dessus, conformément au principe « Same Data Model » de la section 27.

**Note d'usage — identifiants de node** : un `node.id` référencé à l'intérieur d'une expression
(`{{ actions.<id>.output... }}` ou une expression de `condition`) doit être un identifiant valide
au sens de l'évaluateur (lettres/chiffres/`_`, pas de tiret) — l'évaluateur traite `-` comme
l'opérateur de soustraction. Utiliser du camelCase (`extractPrice`), pas du kebab-case
(`extract-price`), pour tout node dont l'id est réutilisé dans une expression — cohérent avec les
exemples du cahier des charges lui-même (§12 : `actions.getUser.output.id`).

## Itération 2 — Backend exécutable : API NestJS + Prisma/PostgreSQL + Worker BullMQ (livrée)

Le moteur de l'itération 1 est maintenant exécutable via HTTP, avec persistance réelle et
exécution découplée de l'API, conformément à la section 17.6 (*« L'API ne doit pas exécuter
directement les crawlers »*).

| Package/App | Rôle | Sections Specs.md |
|---|---|---|
| `packages/database` | Schéma Prisma (`Project`, `Workflow`, `WorkflowVersion`, `Execution`, `ExecutionLog`) + client Prisma partagé (`getPrismaClient`), sans dépendance à NestJS ni BullMQ | §17.5 |
| `packages/queue` | Contrat partagé API↔Worker : `EXECUTION_QUEUE_NAME`, `ExecutionJobData`, `getRedisConnectionOptions()` — aucune dépendance à bullmq/ioredis eux-mêmes | §17.6 |
| `apps/api` | API NestJS (Fastify) : CRUD Projects/Workflows (versionnés), déclenchement d'Execution (écrit en base + enqueue, n'exécute jamais le moteur), historique, health check | §4.1, §15, §17.4 |
| `apps/worker` | Process Node autonome (sans framework) consommant la queue BullMQ, rechargeant la `WorkflowVersion` depuis Postgres, exécutant via `@datarover/workflow-core`, persistant `Execution`/`ExecutionLog` | §17.6, §17.9 (préparation) |

Contrat API exposé (port `API_PORT`, défaut 3001) :

| Méthode | Route | Effet |
|---|---|---|
| `POST` / `GET` / `GET :id` / `PATCH :id` / `DELETE :id` | `/projects` | CRUD projet (cascade sur suppression) |
| `POST` | `/projects/:projectId/workflows` | Crée un workflow + sa `WorkflowVersion` v1 |
| `GET` / `GET :id` / `PATCH :id` / `DELETE :id` | `/projects/:projectId/workflows`, `/workflows/:id` | Liste / détail (avec version courante) / renomme ou crée une nouvelle version / supprime |
| `POST` | `/workflows/:id/executions` | Crée l'`Execution` (`pending`), enqueue le job BullMQ, répond **202** |
| `GET` | `/executions/:id` | Détail : statut, `actionResults`, `logs` |
| `GET` | `/workflows/:id/executions` | Historique des exécutions (§4.1) |
| `GET` | `/health` | Ping Postgres + Redis |

Modèle de données Prisma : `WorkflowVersion` est immutable (modifier un workflow crée une nouvelle
version, §16 « versionné ») ; `Execution.workflowVersionId` fige la version réellement exécutée
même si le workflow est modifié après coup ; `ExecutionLog` est une table séparée (pas un blob JSON)
pour permettre une lecture incrémentale/temps réel à l'itération WebSocket. `Schedule` et
`Credential` (§17.5) ne sont **pas** créés — ils appartiennent aux itérations scheduler/auth, non
demandées ici.

**Piège technique documenté** (voir commentaires dans le code) : NestJS résout l'injection de
dépendances via `emitDecoratorMetadata` (reflect-metadata), qui exige que les classes injectées
restent des imports *valeur* — jamais `import type`. `apps/api` a son propre
`eslint.config.mjs` qui désactive `@typescript-eslint/consistent-type-imports` pour cette
raison ; et ses tests tournent via Vitest+SWC (`apps/api/vitest.config.ts`, `unplugin-swc`) plutôt
que le transform esbuild par défaut de Vitest, qui n'émet pas cette métadonnée.

**Vérifié** (avec un vrai Postgres/Redis via `docker compose up -d postgres redis`) :
`pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` passent tous sans erreur
(257 tests, 17/17 lint et typecheck). Démonstration manuelle bout en bout via `curl` : création
d'un projet → d'un workflow (`GET → Extract → IF → Stop`) → déclenchement d'une exécution → le
worker la traite et la fait passer `pending → success`, avec `ExecutionLog` cohérents et
`GET /health` renvoyant `{ status: "ok", db: "ok", redis: "ok" }`.

## Explicitement hors périmètre à ce stade

- **UI React** (`apps/web`) — éditeur visuel React Flow, preview HTML + sélection visuelle
  d'éléments, gestion graphique des variables, dashboard (§6, §10, §11, §17.2).
- **WebSocket temps réel** (§17.12) — le moteur émet déjà des événements (`onEvent`) et le worker
  persiste des `ExecutionLog` au fil de l'exécution ; rien ne relaie encore ces événements en
  direct vers un client.
- **Scheduler exécutable** (§14) — les types `Schedule`/`ScheduleType` existent, mais ni table
  Prisma, ni cron, ni endpoint.
- **Browser crawling / Playwright** (§5, §17.9) — seul le crawler HTTP (Undici) est implémenté.
- **`FOR EACH` / `WHILE`** (§9.5) — explicitement V2 dans le cahier des charges (§25).
- **Sorties** Webhook/Database/CSV (§9.6) — V2 (§25).
- **XPath** comme stratégie d'extraction — le type existe, l'exécution lève une erreur explicite
  « planned for V2 ».
- **Credentials/Auth**, **Docker complet** (web/api/worker/browser-worker containerisés, §19-21),
  **application Electron** (§17.3, §24) — seul un `docker-compose.yml` minimal (postgres+redis) est
  fourni, pour le développement de ce backend uniquement.

## Prochaines itérations (proposition, non engageante)

1. ~~Backend exécutable~~ — livré (itération 2).
2. **UI minimale** : `apps/web` (Vite + React Flow) branché sur le même modèle
   `WorkflowDefinition`, consommant l'API de l'itération 2, avec exécution manuelle et logs (via
   polling d'abord, WebSocket ensuite).
3. **Preview HTML + sélection visuelle**, **scheduler exécutable**, puis **Docker complet**
   (containerisation de `web`/`api`/`worker`/`browser-worker`) et **coquille Electron**, dans
   l'esprit de la section 24 (MVP v1).

## Comment vérifier

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate   # une fois
cp .env.example .env
docker compose up -d postgres redis     # ou: pnpm infra:up
pnpm install                             # génère aussi le client Prisma
pnpm db:migrate                          # première migration (interactif la 1ère fois : --name init)
pnpm build
pnpm test        # 257 tests Vitest (unitaires + intégration moteur + e2e api/worker sur vrai Postgres/Redis)
pnpm lint
pnpm typecheck

# Démo moteur seul (sans DB/API), scénario "Surveillance catalogue" (§3) :
pnpm --filter @datarover/example-product-monitor start

# Démo backend complet (API + worker), dans deux terminaux après pnpm build :
node apps/api/dist/main.js
node apps/worker/dist/main.js
# puis, dans un 3e terminal : créer un projet, un workflow, déclencher une exécution
# (voir le contrat API ci-dessus — POST /projects, POST /projects/:id/workflows,
# POST /workflows/:id/executions, GET /executions/:id).
```
