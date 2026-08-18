# DataRover

![Logo DataRover](logo.png)

Un environnement de construction de pipelines autonomes de collecte et de traitement de données web.

> Explore the web. Capture the data.

Le cahier des charges complet du produit cible se trouve dans [`Specs.md`](./Specs.md). L'état
réel d'avancement (ce qui est implémenté vs le reste de la vision) est documenté dans
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## État actuel

Deux itérations livrées : le **moteur de workflow** (packages TypeScript purs) et un **backend
exécutable** (API NestJS + PostgreSQL + worker BullMQ) qui l'expose en HTTP. Pas encore d'UI, pas
de Docker complet, pas d'Electron (voir [`ARCHITECTURE.md`](./ARCHITECTURE.md) pour le détail et la
feuille de route).

```text
packages/
├── shared              utilitaires communs (id, sleep, logger)
├── workflow-types       modèle métier partagé (Zod + types TS)
├── expression-engine    interpolation {{ }} + évaluateur d'expressions contrôlé
├── extractor            extraction CSS / JSONPath / XML / Regex
├── workflow-core        le moteur d'exécution de workflow
├── database             schéma Prisma + client partagé (Project/Workflow/Execution/...)
└── queue                contrat partagé API↔worker pour la file BullMQ

apps/
├── api                  API NestJS (Fastify) : projets, workflows, exécutions, health
└── worker               consomme la queue, exécute le moteur, persiste le résultat

examples/
└── product-monitor      démo exécutable du moteur seul (scénario "Surveillance catalogue")
```

## Prérequis

- Node.js ≥ 20 (voir `.nvmrc`)
- pnpm ≥ 9 (via Corepack)
- Docker (pour PostgreSQL + Redis en local — `docker-compose.yml`)

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

## Démarrage

```bash
cp .env.example .env
docker compose up -d postgres redis   # ou: pnpm infra:up
pnpm install                          # génère aussi le client Prisma
pnpm db:migrate                       # première migration (nomme-la ex. "init")
pnpm build                            # build tous les packages/apps
pnpm test                             # 257 tests (unitaires + intégration + e2e api/worker)
pnpm lint
pnpm typecheck

# Démo moteur seul, sans DB/API : GET → Extract → IF, rejouée avec le moteur réel
pnpm --filter @datarover/example-product-monitor start

# Démo backend complet : deux process séparés (l'API n'exécute jamais le moteur elle-même)
node apps/api/dist/main.js      # écoute sur $API_PORT (3001 par défaut)
node apps/worker/dist/main.js   # consomme la queue et exécute les workflows
```

## Licence

MIT — voir [`LICENSE`](./LICENSE).