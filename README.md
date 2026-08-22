# DataRover

![Logo DataRover](logo.png)

Un environnement de construction de pipelines autonomes de collecte et de traitement de données web.

> Explore the web. Capture the data.

Le cahier des charges complet du produit cible se trouve dans [`Specs.md`](./Specs.md). L'état
réel d'avancement (ce qui est implémenté vs le reste de la vision) est documenté dans
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## État actuel

Treize itérations livrées : le **moteur de workflow** (packages TypeScript purs), un **backend
exécutable** (API NestJS + PostgreSQL + worker BullMQ), une **UI React** (éditeur visuel React
Flow, **plein écran**, panneau d'inspection redimensionnable) branchée dessus, l'outil de
**preview HTML/JSON/XML + sélection visuelle d'éléments** (cliquer un élément dans un aperçu
sandboxé — ou un nœud dans un arbre JSON/XML colorisé et repliable — avec rendu JavaScript
optionnel pour les pages React/Vue, pour générer un node d'extraction), des **nodes de traitement
de données** (`dataTransform`, affiché "Traitement" — entrée brute/JSON/YAML/XML, sortie
texte/liste/tableau/entier/décimal/booléen déduite automatiquement de la dernière opération ;
`textCrypto` : hash/encodage/chiffrement symétrique et RSA) et de **boucle** (`loop`, corps
intégré, itère sur une liste/un tableau), un **scheduler exécutable** (déclenchement récurrent
manuel/intervalle/horaire/quotidien/hebdomadaire/cron, via BullMQ), un **environnement Docker
complet** (`docker compose up --build` démarre `web`/`api`/`worker`/`browser-worker` — le rendu
JavaScript isolé dans son propre service — `postgres`/`redis`, migrations comprises), et un node
**"Navigateur"** (`browserAction`) qui simule une vraie interaction utilisateur (clic, frappe
clavier caractère par caractère, survol, glisser-déposer, déplacement de souris vers une position
précise ou aléatoire) via un vrai navigateur Playwright piloté par `browser-worker` — avec, pour la
frappe et les déplacements de souris, un délai optionnel **fixe ou aléatoire** (min–max, tiré à
nouveau à chaque exécution) pour simuler un temps de réaction humain plutôt qu'une cadence
parfaitement régulière. Ce node dispose aussi d'une **preview live avec enregistreur d'actions** :
un bouton dans son inspecteur ouvre un aperçu du navigateur en direct (streaming vidéo via
screencast CDP), pilotable à la souris/au clavier depuis le navigateur de l'utilisateur, avec un
bouton "Enregistrer" qui détecte clic/sélection/frappe/déplacement de souris/défilement/survol et
les propose comme actions à ajouter au node. Chaque étape peut être **réordonnée** (▲/▼) ou
**réenregistrée en place** (bouton "🔄 réenregistrer" sur les types que l'enregistreur sait
produire) — pratique pour corriger une seule étape déjà enregistrée (ex. un sélecteur devenu
ambigu après une évolution de la page cible) sans devoir tout refaire ni réordonner à la main. La
**disposition des nodes dans l'éditeur visuel est
désormais sauvegardée** avec le workflow (position de chaque node) — plus besoin de tout
réorganiser à chaque réouverture. Un **pool de proxies global** (menu "Proxies" de l'en-tête) est
désormais disponible pour les nodes `http`/`browserAction` : mode réseau "Adresse actuelle"
(défaut) ou "Proxy disponible", auquel cas le système réserve automatiquement un proxy libre du
pool pour la durée du node, incrémente son compteur d'erreurs en cas d'échec, et le supprime
définitivement une fois un seuil configurable atteint (5 par défaut, réglable via une page de
configuration dédiée). Le panneau d'inspection affiche désormais, pour tout node, ses
**variables de sortie**
(`{{ actions.http1.output.status }}`, etc., un clic pour copier), et chaque champ `{{ }}` de
l'éditeur propose une **autocomplétion** de ces variables (et des variables globales du projet) dès
qu'on tape `{{`. Reste **Electron** (voir [`ARCHITECTURE.md`](./ARCHITECTURE.md) pour le détail et
la feuille de route).

```text
packages/
├── shared              utilitaires communs (id, sleep, logger)
├── workflow-types       modèle métier partagé (Zod + types TS)
├── expression-engine    interpolation {{ }} + évaluateur d'expressions contrôlé
├── extractor            extraction CSS / JSONPath / XML / Regex
├── workflow-core        le moteur d'exécution de workflow
├── browser-scripts      fonctions de calcul de sélecteur partagées preview iframe ↔ enregistreur
├── database             schéma Prisma + client partagé (Project/Workflow/Execution/...)
└── queue                contrat partagé API↔worker pour la file BullMQ

apps/
├── api                  API NestJS (Fastify) : projets, workflows, exécutions, health, scheduler
├── worker               consomme la queue, exécute le moteur, persiste le résultat
├── browser-worker       rendu JavaScript (Playwright) — preview (appelé par l'API) et node
│                        "Navigateur" (appelé directement par le worker)
└── web                  UI React (Vite + React Flow) : éditeur visuel, exécution, suivi

examples/
└── product-monitor      démo exécutable du moteur seul (scénario "Surveillance catalogue")
```

## Prérequis

- Node.js ≥ 20 (voir `.nvmrc`)
- pnpm ≥ 9 (via Corepack)
- Docker (pour PostgreSQL + Redis en local en mode développement — `docker-compose.yml` — ou pour
  l'environnement Docker complet, voir [Docker](#docker) plus bas)
- Un vrai Firefox installé (pour `pnpm test:e2e`, voir "Tests e2e navigateur" plus bas)
- Optionnel en développement local (fourni automatiquement dans l'image Docker de
  `apps/browser-worker`) — Google Chrome ou Chromium installé, pour l'option "Rendu JavaScript" de
  l'outil de preview HTML (`apps/browser-worker/src/render/render.service.ts`) : nécessaire
  uniquement pour prévisualiser des pages dont le contenu réel n'existe qu'après exécution du JS
  côté client (une SPA React/Vue/etc.) ; sans Chrome installé, tout le reste de l'app fonctionne
  normalement, seule cette case à cocher renvoie une erreur explicite si on l'active. Chemin
  détecté automatiquement (`/usr/bin/google-chrome`, etc.) ou fourni via `CHROME_EXECUTABLE_PATH`.

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

Lance **en parallèle**, avec rechargement à chaud, les quatre apps (via le pipeline `dev` de
Turborepo, persistant) :

| App | Commande sous-jacente | Adresse |
|---|---|---|
| `apps/api` | `nest start --watch` | http://localhost:3001 (`$API_PORT`) |
| `apps/worker` | `tsx watch src/main.ts` | — (aucun port, consomme la queue) |
| `apps/browser-worker` | `nest start --watch` | http://localhost:3002 (`$BROWSER_WORKER_PORT`) — appelé uniquement par `apps/api`, jamais par le navigateur |
| `apps/web` | `vite` | http://localhost:5173 (`$WEB_PORT`) |

Pour lancer une seule app en développement (utile pour ne pas noyer les logs des autres) :

```bash
pnpm --filter @datarover/api dev
pnpm --filter @datarover/worker dev
pnpm --filter @datarover/browser-worker dev
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

Puis, en quatre process séparés (l'API n'exécute **jamais** le moteur elle-même — voir
l'itération 2 dans [`ARCHITECTURE.md`](./ARCHITECTURE.md)) :

```bash
node apps/api/dist/main.js             # API — écoute sur $API_PORT (3001 par défaut)
node apps/worker/dist/main.js          # Worker — consomme la queue BullMQ et exécute les workflows
node apps/browser-worker/dist/main.js  # Rendu JavaScript pour l'outil de preview (appelé par l'API)
pnpm --filter @datarover/web preview   # sert le build statique de l'UI (vérification locale)
```

`vite preview` sert `apps/web/dist` localement pour vérifier un build de production — ce n'est pas
un serveur web de production (pas de compression/cache/TLS) ; **l'environnement Docker complet**
(voir [Docker](#docker) ci-dessous) sert ce même dossier via un vrai nginx et couvre les quatre
process ci-dessus en une seule commande — c'est la voie recommandée pour un déploiement réel.

Variables d'environnement à définir en production : voir [`.env.example`](./.env.example)
(`DATABASE_URL`, `REDIS_HOST`/`REDIS_PORT`, `API_PORT`, `WEB_ORIGIN`, `WORKER_CONCURRENCY`,
`BROWSER_WORKER_PORT`/`BROWSER_WORKER_URL`, `VITE_API_URL` — cette dernière doit pointer vers
l'URL publique de l'API et être fournie **au moment du build** de `apps/web`, Vite l'inline dans le
bundle statique).

---

## Docker

Environnement complet (Specs.md §19-21) : `web`, `api`, `worker`, `browser-worker` (rendu
JavaScript de l'outil de preview, isolé dans son propre service — voir `ARCHITECTURE.md`,
itération 8), `postgres`, `redis` — tout sur un seul réseau Docker, migrations comprises (le
service `migrate` s'exécute une fois puis s'arrête, `api`/`worker` attendent sa réussite avant de
démarrer).

```bash
cp .env.example .env
docker compose up --build     # web (http://localhost:5173), api (http://localhost:3001), ...
docker compose ps             # api/browser-worker doivent apparaître "healthy"
docker compose logs -f api worker browser-worker
docker compose down           # arrête les conteneurs (conserve les volumes/données)
docker compose down -v        # arrête ET supprime les volumes (repart d'une base vide)
docker compose up -d --scale worker=3   # plusieurs workers (Specs.md §20 — scalable horizontalement)
```

Mode développement (hot reload nest/tsx/vite, dépôt monté en volume — modifier un fichier sur
l'hôte se répercute immédiatement dans le conteneur) :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

**Les deux `-f` sont obligatoires à chaque fois** — `docker compose up` seul (ou avec un seul
`-f docker-compose.yml`) démarre les images de **production** : pas de montage du dépôt en volume,
donc aucun changement de fichier ne sera jamais visible, peu importe combien de fois on relance ou
reconstruit. C'est la cause la plus fréquente de "je ne vois pas mes changements" : vérifier
`docker compose ps` — en mode dev, la commande de chaque conteneur `api`/`worker`/`browser-
worker`/`web` doit apparaître comme `pnpm --filter ... dev` (nest/tsx/vite en mode watch), jamais
`node dist/main.js`.

Une fois les conteneurs de dev démarrés, éditer un fichier `.ts`/`.tsx` source suffit — nest/tsx/vite
en mode watch le détectent immédiatement à l'intérieur du conteneur, **sans jamais relancer
`docker compose up`**. `--build` (ou `--force-recreate`) n'est nécessaire que pour reconstruire
l'image elle-même, dans deux cas précis :
- la première fois (l'image n'existe pas encore) ;
- après avoir modifié un `package.json` ou `pnpm-lock.yaml` (nouvelle dépendance, ajout d'un
  package workspace, etc.) — `Dockerfile.dev` exécute `pnpm install` une seule fois, **au moment de
  la construction de l'image**, puis `docker-compose.dev.yml` masque le `node_modules` du montage
  par un volume anonyme qui garde ce `node_modules` figé entre deux redémarrages (voir le
  commentaire d'en-tête de `Dockerfile.dev`) : le dépôt source est bien monté en direct, mais pas
  `node_modules` — un `pnpm install` fait seulement sur l'hôte, ou un fichier ajouté dans un
  workspace pas encore connu du `node_modules` de l'image, ne sera invisible depuis le conteneur
  qu'après un nouveau `--build`.

**Un troisième cas, différent des deux ci-dessus, nécessite non pas un `--build` mais un simple
`docker compose restart <service>`** : modifier un package **partagé** (`packages/workflow-types`,
`packages/workflow-core`, …) pendant qu'un service qui en dépend tourne déjà. `nest start --watch`
(`api`, `browser-worker`) et `tsx watch` (`worker`) ne surveillent que leur propre `src/` — jamais
le `dist/` d'un package workspace dont ils dépendent. Le fichier source ET son `dist/` recompilé
sont bien à jour sur disque (montage en direct), mais le **process Node déjà démarré** garde en
mémoire la version du schéma chargée à son propre démarrage — `require()`/`import` ne relit jamais
un module déjà chargé. Symptôme typique : après avoir ajouté un champ ou une variante à un schéma
Zod partagé, certaines valeurs (les nouvelles) se voient rejetées à l'enregistrement pendant que
les anciennes fonctionnent toujours — pas une erreur de validation en apparence liée au champ
modifié, juste "certaines actions/valeurs ne s'enregistrent pas". Un `docker compose restart api
worker browser-worker` (ou le service concerné) force chacun à relire son `dist/` à jamais au
prochain démarrage, sans reconstruire d'image.

**Un quatrième cas** : le volume anonyme `node_modules` d'un service peut rester incomplet même
juste après un `--force-recreate -V` (client Prisma jamais généré, lien de workspace manquant vers
un package tout juste ajouté) — l'écart reste invisible tant qu'aucun changement de fichier ne
force `nest start --watch`/`tsx watch` à recompiler, donc peut n'apparaître que des heures plus
tard, au premier changement réel. Symptôme côté `api`/`worker` : des dizaines d'erreurs
`tsc` sur des propriétés Prisma pourtant réelles ; côté `browser-worker`/autre service : un module
workspace introuvable. Se rattrape sans reconstruire l'image :
`docker compose exec <service> sh -c "CI=true pnpm install --frozen-lockfile"` (le `CI=true` évite
l'invite interactive "recréer les node_modules ?" en shell non interactif) régénère le client
Prisma et les liens manquants — puis un `docker compose restart <service>` séparé est nécessaire
dans certains cas : `tsc --watch` ne réinvalide pas une résolution de module déjà en échec
simplement parce qu'un lien symbolique apparaît sur disque après coup.

**`pnpm turbo run build` sur l'hôte n'est pas le seul à risque — `typecheck`/`lint`/`test` le sont
tout autant.** `turbo.json` déclare ces quatre tâches avec `"dependsOn": ["^build"]` : lancer
n'importe laquelle, même filtrée sur un seul service (`--filter=@datarover/api`), reconstruit
d'abord silencieusement tous ses packages workspace dépendants (`workflow-types`,
`browser-scripts`, `database`, …) — et leur `build` (`tsup`) commence par **vider** leur `dist/`
avant de le réécrire. Si un conteneur de dev tourne déjà et dépend de l'un de ces packages, son
propre `tsc --watch` (qui lit ce même `dist/`, monté en volume) peut traverser cette fenêtre videe
et mémoriser à tort "module introuvable" — de façon durable : contrairement à une simple
recompilation, ce cache de résolution ne se corrige pas tout seul au prochain changement de
fichier, même une fois le vrai `dist/` réécrit correctement juste après. Symptôme : des dizaines
d'erreurs sur des propriétés/modules qui existent bien, y compris longtemps après la commande hôte
qui les a déclenchées (le service continue de servir sa dernière compilation réussie jusqu'au
prochain changement de fichier — le problème peut donc rester invisible pendant des heures).
Rien à réinstaller dans ce cas, juste `docker compose restart <service>` pour repartir d'une
compilation fraîche — **par réflexe, après toute commande `pnpm turbo run ...` lancée côté hôte**
tant qu'un conteneur de dev dépendant du package concerné tourne.

Tout est construit à partir d'un **unique** `Dockerfile`/`Dockerfile.dev` partagé (Specs.md §21) —
`turbo prune` réduit le monorepo à ce dont chaque service a réellement besoin ; `--target` choisit
l'image finale (`runner` pour `api`/`worker`, `runner-browser-worker` — `runner` + un vrai
Chromium —, `runner-web` — nginx servant le build statique —, `runner-migrate`). Détails/pièges
rencontrés : voir `ARCHITECTURE.md`, itération 8.

Si un process local (`pnpm dev`) tourne déjà sur les mêmes ports (3001/3002/5173/5432/6379),
arrête-le d'abord — Docker et le mode local ne sont pas censés cohabiter sur les mêmes ports. Si
des conteneurs de **production** tournent déjà (démarrés sans `docker-compose.dev.yml`), relancer
directement avec les deux `-f` reconfigure les services en place (pas besoin de `down` d'abord),
mais `docker compose down` puis la commande dev reste l'option la plus sûre en cas de doute.
Les identifiants/ports sont configurables via `.env` (voir [`.env.example`](./.env.example)) ;
tout fonctionne aussi sans aucun `.env` (valeurs par défaut intégrées dans `docker-compose.yml`).

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
| `apps/api` | **Tests e2e** (requêtes réelles via l'injection Fastify) contre un **vrai** Postgres/Redis — nécessite `pnpm infra:up` au préalable ; le rendu JavaScript (`render: true`) est testé contre un faux `browser-worker` (fixture HTTP), pas un vrai Chrome — voir `apps/browser-worker` ci-dessous |
| `apps/worker` | **Test d'intégration** : exécute un vrai job contre Postgres/Redis + un serveur HTTP local de fixture, y compris un vrai déclenchement de planification en temps réel (BullMQ job scheduler) |
| `apps/browser-worker` | **Tests e2e** contre un **vrai** Chrome/Chromium (SPA rendue, bandeau de consentement dismiss, en-têtes transmis, cible injoignable → 400) — nécessite un Chrome/Chromium installé localement (voir [Prérequis](#prérequis)) |
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
`geckodriver`) plusieurs parcours :

- `workflow.e2e.test.ts` — celui de la vérification manuelle de l'itération 3 : créer un projet →
  créer un workflow → ajouter un node HTTP via la palette → l'éditer dans l'inspecteur →
  enregistrer → exécuter → attendre que l'exécution passe à un statut final et vérifier que la
  page affiche "Succès" et son journal.
- `preview.e2e.test.ts` — celui de l'itération 4 (preview HTML + sélection visuelle, §6/§8),
  **étendu au JSON** : deux scénarios. Le premier pointe un node HTTP vers un serveur de fixture
  local, ouvre l'aperçu, **bascule le contexte WebDriver dans l'iframe sandboxée** pour cliquer un
  vrai élément, vérifie que les sélecteurs candidats affichés correspondent à l'exemple du cahier
  des charges, valide la règle, et confirme qu'un node `extract` relié apparaît dans le canvas. Le
  second pointe un node HTTP vers une réponse JSON, ouvre l'aperçu (l'arbre replié/colorisé
  `JsonTreeView`), déplie un nœud replié par défaut, clique une valeur, vérifie que le candidat
  calculé est le JSONPath canonique (`$.items[0].price`), valide la règle, et confirme qu'un node
  `extract` avec `sourceType: "json"` apparaît relié.
- `nodeContextMenu.e2e.test.ts` — celui de l'itération 5 : chaque bouton de la palette affiche son
  point de couleur, les nodes `dataTransform`/`textCrypto` s'ajoutent et s'éditent, un clic droit
  sur un node ouvre le menu contextuel personnalisé, "Dupliquer" crée un node distinct (vérifié via
  l'attribut `data-id` de React Flow) et "Supprimer" ne retire que le node ciblé.
- `loopNode.e2e.test.ts` — celui de l'itération 6 (node "Boucle") : création d'un node `loop` via
  la palette, réglage de `source` sur une variable globale du projet, dépliage/édition de l'étape
  par défaut du corps intégré (une `setVariable` imbriquée — prouve que la composition récursive
  d'inspecteurs fonctionne réellement dans un navigateur), sauvegarde puis **rechargement complet
  de la page** pour vérifier que chaque champ a traversé l'aller-retour API. La preuve d'exécution
  réelle du node (liaison `item`/`runtime`, modes de sortie) vit côté moteur
  (`packages/workflow-core/src/{engine,executors/loopExecutor}.test.ts`) plutôt qu'ici — voir
  ARCHITECTURE.md, itération 6, pour la limite pré-existante de l'éditeur qui explique ce choix.
- `inspectorPanelResize.e2e.test.ts` — panneau d'inspection redimensionnable : sélectionne un
  node, fait glisser la poignée sur son bord gauche avec un vrai geste pointeur (`driver.actions()`)
  de 100px vers la gauche, vérifie que le panneau s'élargit réellement en conséquence, puis
  recharge la page et confirme que la largeur choisie a survécu (persistée en `localStorage`).
- `schedules.e2e.test.ts` — celui de l'itération 7 (scheduler, §14) : ouvre le panneau "⏱
  Planification", ajoute une planification "toutes les 15 minutes", l'active/désactive réellement,
  soumet une expression cron invalide (message d'erreur visible, aucune ligne créée) puis une
  valide, supprime la première planification, et recharge la page pour confirmer que celle qui
  reste a bien persisté côté serveur.

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