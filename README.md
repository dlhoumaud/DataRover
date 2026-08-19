# DataRover

![Logo DataRover](logo.png)

Un environnement de construction de pipelines autonomes de collecte et de traitement de données web.

> Explore the web. Capture the data.

Le cahier des charges complet du produit cible se trouve dans [`Specs.md`](./Specs.md). L'état
réel d'avancement (ce qui est implémenté vs le reste de la vision) est documenté dans
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## État actuel

Quatre itérations livrées : le **moteur de workflow** (packages TypeScript purs), un **backend
exécutable** (API NestJS + PostgreSQL + worker BullMQ), une **UI React** (éditeur visuel React
Flow) branchée dessus, et l'outil de **preview HTML + sélection visuelle d'éléments** (cliquer un
élément dans un aperçu sandboxé de la page cible pour générer un node d'extraction). Pas encore de
scheduler exécutable, de Docker complet ni d'Electron (voir
[`ARCHITECTURE.md`](./ARCHITECTURE.md) pour le détail et la feuille de route).

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
├── worker               consomme la queue, exécute le moteur, persiste le résultat
└── web                  UI React (Vite + React Flow) : éditeur visuel, exécution, suivi

examples/
└── product-monitor      démo exécutable du moteur seul (scénario "Surveillance catalogue")
```

## Prérequis

- Node.js ≥ 20 (voir `.nvmrc`)
- pnpm ≥ 9 (via Corepack)
- Docker (pour PostgreSQL + Redis en local — `docker-compose.yml`)
- Un vrai Firefox installé (pour `pnpm test:e2e`, voir "Tests e2e navigateur" plus bas)
- Optionnel — Google Chrome ou Chromium installé, pour l'option "Rendu JavaScript" de l'outil de
  preview HTML (`apps/api/src/tools/browser-renderer.service.ts`) : nécessaire uniquement pour
  prévisualiser des pages dont le contenu réel n'existe qu'après exécution du JS côté client (une
  SPA React/Vue/etc.) ; sans Chrome installé, tout le reste de l'app fonctionne normalement, seule
  cette case à cocher renvoie une erreur explicite si on l'active. Chemin détecté automatiquement
  (`/usr/bin/google-chrome`, etc.) ou fourni via `CHROME_EXECUTABLE_PATH`.

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

## Installation

```bash
cp .env.example .env
docker compose up -d postgres redis   # ou: pnpm infra:up
pnpm install                          # génère aussi le client Prisma (postinstall)
pnpm db:migrate                       # première migration + données d'exemple (voir ci-dessous)
```

`pnpm db:migrate` crée automatiquement, à la première exécution, un projet d'exemple **"Veille
e-commerce"** avec deux workflows réalistes et exécutables (surveillance de prix et de qualité
produit sur une vraie API publique, `fakestoreapi.com`) — pour que l'UI ne s'ouvre jamais sur une
liste de projets vide. Voir [`packages/database/prisma/seed.ts`](./packages/database/prisma/seed.ts).

Scripts liés à la base de données (voir [`packages/database`](./packages/database)) :

| Commande | Effet |
|---|---|
| `pnpm db:generate` | Régénère le client Prisma après une modification du schéma |
| `pnpm db:migrate` | Crée/applique une migration en dev (`prisma migrate dev`), **puis lance le seed** |
| `pnpm db:migrate:deploy` | Applique les migrations existantes sans en créer (usage prod/CI) — **ne seed jamais** |
| `pnpm db:seed` | Relance juste le seed (idempotent — sûr à rejouer, ne duplique/n'écrase rien) |
| `pnpm db:studio` | Ouvre Prisma Studio (explorateur de données) |

> Le seed utilise des id fixes (`seed-*`) et un `upsert` : le rejouer (ce que fait aussi chaque
> `pnpm db:migrate`) ne crée jamais de doublon et ne réécrase pas les modifications que vous auriez
> faites sur ce projet depuis l'UI.

> **Un seul `.env`, à la racine.** Les scripts `dev`/`start`/`test` d'`apps/api`, `apps/worker` et
> les scripts Prisma de `packages/database` le chargent automatiquement via `dotenv-cli`
> (`dotenv -e ../../.env -- ...`), quel que soit le dossier depuis lequel Turborepo/pnpm les
> exécute — inutile de faire `source .env` à la main, et surtout **ne crée pas de `.env` dans
> `apps/api`, `apps/worker` ou ailleurs** : un second fichier finit par désynchroniser des valeurs
> (port, identifiants...) et produit des bugs difficiles à diagnostiquer. `apps/web` gère son
> propre chargement via `envDir` dans `vite.config.ts` (mécanisme Vite, pointé vers ce même `.env`
> racine) — rien à faire de spécial là non plus.

---

## Mode développement

Prérequis : Postgres/Redis démarrés (`pnpm infra:up`) et `.env` renseigné.

```bash
pnpm dev
```

Lance **en parallèle**, avec rechargement à chaud, les trois apps (via le pipeline `dev` de
Turborepo, persistant) :

| App | Commande sous-jacente | Adresse |
|---|---|---|
| `apps/api` | `nest start --watch` | http://localhost:3001 (`$API_PORT`) |
| `apps/worker` | `tsx watch src/main.ts` | — (aucun port, consomme la queue) |
| `apps/web` | `vite` | http://localhost:5173 (`$WEB_PORT`) |

Pour lancer une seule app en développement (utile pour ne pas noyer les logs des deux autres) :

```bash
pnpm --filter @datarover/api dev
pnpm --filter @datarover/worker dev
pnpm --filter @datarover/web dev
```

Démo du moteur seul, sans DB/API (rejoue le scénario "Surveillance catalogue" de `Specs.md` §3) :

```bash
pnpm --filter @datarover/example-product-monitor start
```

---

## Mode production

```bash
pnpm build   # build tous les packages/apps (tsup pour les packages, nest build / vite build pour les apps)
```

Puis, en trois process séparés (l'API n'exécute **jamais** le moteur elle-même — voir
l'itération 2 dans [`ARCHITECTURE.md`](./ARCHITECTURE.md)) :

```bash
node apps/api/dist/main.js       # API — écoute sur $API_PORT (3001 par défaut)
node apps/worker/dist/main.js    # Worker — consomme la queue BullMQ et exécute les workflows
pnpm --filter @datarover/web preview   # sert le build statique de l'UI (vérification locale)
```

`vite preview` sert `apps/web/dist` localement pour vérifier un build de production — ce n'est pas
un serveur web de production (pas de compression/cache/TLS). Le déploiement réel de ce dossier
statique derrière un vrai serveur/CDN fait partie de l'itération "Docker complet" à venir (voir
feuille de route dans `ARCHITECTURE.md`).

Variables d'environnement à définir en production : voir [`.env.example`](./.env.example)
(`DATABASE_URL`, `REDIS_HOST`/`REDIS_PORT`, `API_PORT`, `WEB_ORIGIN`, `WORKER_CONCURRENCY`,
`VITE_API_URL` — cette dernière doit pointer vers l'URL publique de l'API et être fournie **au
moment du build** de `apps/web`, Vite l'inline dans le bundle statique).

---

## Docker

Le dépôt fournit un `docker-compose.yml` **minimal** : uniquement les dépendances avec état
(PostgreSQL, Redis), pas encore la containerisation complète de `web`/`api`/`worker` décrite au
§19-21 du cahier des charges (c'est un point de la feuille de route, voir `ARCHITECTURE.md`).

```bash
docker compose up -d          # démarre postgres + redis (équivalent à pnpm infra:up)
docker compose ps             # vérifier que les deux services sont "healthy"
docker compose logs -f postgres redis   # suivre les logs
docker compose down           # arrête les conteneurs (conserve les volumes/données)
docker compose down -v        # arrête ET supprime les volumes (repart d'une base vide)
```

Les identifiants/ports sont configurables via `.env` (`POSTGRES_*`, `REDIS_*`) — voir
[`.env.example`](./.env.example). Une fois les conteneurs up, suis la section
[Mode développement](#mode-développement) ou [Mode production](#mode-production) ci-dessus pour
lancer l'API/le worker/l'UI (en local, hors Docker, pour cette itération).

---

## Tests

### Tests unitaires et d'intégration (tout le monorepo)

```bash
pnpm test          # lance la suite Vitest de chaque package/app (turbo run test)
pnpm test:watch    # équivalent en mode watch
pnpm --filter <nom-du-package> test   # cibler un seul package, ex. :
pnpm --filter @datarover/workflow-core test
pnpm --filter @datarover/api test
```

Turborepo build automatiquement les dépendances d'un package avant de tester (`dependsOn:
["^build"]`) — pas besoin de lancer `pnpm build` séparément avant `pnpm test`.

| Package / app | Ce que couvre sa suite |
|---|---|
| `packages/shared` | id, sleep, logger |
| `packages/workflow-types` | Schémas Zod (validation/rejet de chaque variante de node, workflow, execution) |
| `packages/expression-engine` | Tokenizer/parser/évaluateur d'expressions, interpolation `{{ }}`, sécurité (pas d'exécution de code arbitraire) |
| `packages/extractor` | Extraction CSS/JSONPath/XML/Regex, score de robustesse des sélecteurs |
| `packages/workflow-core` | Moteur : retry/timeout, parcours de graphe, **test d'intégration** avec un vrai serveur HTTP local |
| `packages/queue` | Lecture des options de connexion Redis depuis l'environnement |
| `apps/api` | **Tests e2e** (requêtes réelles via l'injection Fastify) contre un **vrai** Postgres/Redis — nécessite `pnpm infra:up` au préalable |
| `apps/worker` | **Test d'intégration** : exécute un vrai job contre Postgres/Redis + un serveur HTTP local de fixture |
| `apps/web` | Voir [Tests de l'UI](#tests-de-lui-appsweb) ci-dessous |

Les suites d'`apps/api` et `apps/worker` ont besoin d'une vraie base/queue disponibles
(`pnpm infra:up` puis `pnpm db:migrate` si ce n'est pas déjà fait) — ce ne sont pas des mocks.

### Tests de l'UI (`apps/web`)

```bash
pnpm --filter @datarover/web test        # Vitest + jsdom + @testing-library/react
pnpm --filter @datarover/web test:watch
```

Couvre aujourd'hui la logique dont dépend l'interface : l'aller-retour
`WorkflowDefinition ⇄ nodes/edges React Flow` (`src/lib/workflowGraph.ts`), le client HTTP
(`src/api/client.ts` — gestion des erreurs, statut 204, en-têtes conditionnels), et le nettoyage
`DOMParser` de l'outil de preview HTML (`src/lib/htmlSandbox.ts` — retrait effectif des
`<script>`/attributs d'événement/URLs `javascript:`, injection du `<base>`). Ces tests ne lancent
pas de navigateur (jsdom suffit, y compris pour `DOMParser`) ; l'infrastructure
(`@testing-library/react` déjà en devDependencies) est prête pour des tests de rendu de composants
au fur et à mesure qu'ils seront ajoutés.

### Tests e2e navigateur (`apps/web/e2e`)

Rejoue dans un **vrai navigateur** (Firefox headless, piloté via `selenium-webdriver` +
`geckodriver`) deux parcours :

- `workflow.e2e.test.ts` — celui de la vérification manuelle de l'itération 3 : créer un projet →
  créer un workflow → ajouter un node HTTP via la palette → l'éditer dans l'inspecteur →
  enregistrer → exécuter → attendre que l'exécution passe à un statut final et vérifier que la
  page affiche "Succès" et son journal.
- `htmlPreview.e2e.test.ts` — celui de l'itération 4 (preview HTML + sélection visuelle, §6/§8) :
  pointer un node HTTP vers un serveur de fixture local, ouvrir l'aperçu, **basculer le contexte
  WebDriver dans l'iframe sandboxée** pour cliquer un vrai élément, vérifier que les sélecteurs
  candidats affichés correspondent à l'exemple du cahier des charges, valider la règle, et
  confirmer qu'un node `extract` relié apparaît dans le canvas.

Firefox plutôt que Chromium/Playwright : le Chromium embarqué par Playwright nécessite des
bibliothèques système installées via `sudo apt-get`, indisponible sur certaines machines de dev de
ce projet. Firefox (déjà présent) + le protocole standard W3C WebDriver n'a besoin de rien de plus.

**Prérequis — toute la stack doit tourner** (l'API n'est jamais démarrée par le test lui-même) :

```bash
pnpm infra:up   # postgres + redis
pnpm dev        # ou : node apps/api/dist/main.js & node apps/worker/dist/main.js & (mode prod)
                # + pnpm --filter @datarover/web dev (ou "preview" en mode prod)
```

Puis, dans un autre terminal :

```bash
pnpm test:e2e                              # depuis la racine (turbo run test:e2e)
pnpm --filter @datarover/web test:e2e      # équivalent, ciblé
```

Si un prérequis manque, le test échoue tout de suite avec un message explicite plutôt qu'un
timeout Selenium opaque, ex. : `The API is not reachable at http://localhost:3001/health (...).
run "pnpm infra:up" and "pnpm dev" first.`

Variables d'environnement optionnelles :

| Variable | Rôle | Défaut |
|---|---|---|
| `E2E_WEB_URL` | URL de l'UI à piloter | `http://localhost:5173` |
| `E2E_API_URL` | URL de l'API (readiness check + nettoyage des données du test) | `http://localhost:3001` |
| `FIREFOX_BIN` | Chemin du binaire Firefox si la détection automatique échoue (`apps/web/e2e/support/firefox.ts` couvre le paquet snap Ubuntu, le `.deb` Debian/Ubuntu, l'ESR Debian et macOS) | détection automatique |

Cette suite est **exclue** de `pnpm test` (voir `exclude` dans `apps/web/vite.config.ts` et le
`vitest.e2e.config.ts` séparé) : elle a des prérequis (navigateur, stack complète démarrée) et un
temps d'exécution que la suite par défaut n'a pas.

### Qualité (lint & types)

```bash
pnpm lint        # ESLint sur tout le monorepo
pnpm typecheck   # tsc --noEmit sur tout le monorepo
```

---

## Licence

MIT — voir [`LICENSE`](./LICENSE).