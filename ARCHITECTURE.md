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

## Itération 3 — UI minimale : `apps/web` (React + Vite + React Flow) (livrée)

Une interface React branchée sur le backend de l'itération 2, permettant de construire
visuellement un workflow et de suivre son exécution — sans preview HTML/sélection visuelle ni
WebSocket, conformément au principe de la section 27 (React Flow **représente** le modèle
`WorkflowDefinition`, il ne le redéfinit pas : `@datarover/workflow-types` est importé directement
côté UI, aucun type dupliqué).

| Zone | Contenu |
|---|---|
| `src/api/*.ts` | Hooks TanStack Query v5 vers l'API (`useProjects`, `useWorkflows`, `useExecution` avec polling 1s tant que le statut n'est pas final, etc.) |
| `src/lib/workflowGraph.ts` | Conversion `WorkflowDefinition` ⇄ nodes/edges React Flow ; **aucune position n'est persistée** (§27 : la mise en page est recalculée par un auto-layout BFS à chaque chargement, ce n'est pas une donnée du modèle) ; `generateNodeId` garantit des ids de node valides (camelCase, jamais de tiret) par construction |
| `src/lib/editorStore.ts` | Petit store Zustand (node sélectionné, indicateur "modifications non enregistrées") |
| `src/pages/ProjectsPage`, `ProjectDetailPage` | Liste/création de projets (variables globales en JSON), liste/création de workflows |
| `src/pages/WorkflowEditorPage` + `components/nodes`, `components/inspectors` | Canvas React Flow, palette (5 types de node), formulaire d'inspection par type (`http`/`extract`/`condition`/`setVariable`/`stop`), sauvegarde (`PATCH /workflows/:id` → nouvelle `WorkflowVersion`), déclenchement (`POST .../executions`) |
| `src/pages/ExecutionsPage`, `ExecutionDetailPage` | Historique, détail avec statut/résultats/journal en direct (polling) |

**Vérifié** : `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` verts (278
tests). Parcours complet dans un vrai navigateur (Firefox headless piloté via `selenium-webdriver`
— voir note technique ci-dessous) : création d'un projet → d'un workflow → ajout d'un node HTTP
via la palette → édition dans le formulaire d'inspection → sauvegarde → exécution → la page de
détail affiche `Succès` avec le journal d'exécution. Ce parcours a d'abord été vérifié à la main,
puis formalisé en suite automatisée committée (`apps/web/e2e/`, `pnpm test:e2e` — voir le README,
section « Tests e2e navigateur »).

### Trois bugs réels trouvés et corrigés pendant la vérification visuelle

Aucun des trois n'était détectable par les tests automatisés (qui mockent `fetch` ou tournent côté
Node sans navigateur) — c'est précisément ce que la vérification manuelle dans un vrai navigateur
est censée attraper :

1. **`app.enableCors()` semblait ne jamais s'appliquer.** Cause réelle : la création de
   `apps/api/vitest.config.ts` (fait pour un autre correctif, voir plus bas) a changé le `rootDir`
   que `tsc` infère pour `nest build`, qui s'est mis à compiler vers `dist/src/main.js` au lieu de
   `dist/main.js` — le script `"start": "node dist/main.js"` exécutait donc silencieusement un
   *ancien* build, jamais le code à jour. Fixé en fixant explicitement `rootDir: "src"` dans
   `apps/api/tsconfig.build.json` (et en excluant `vitest.config.ts` de la compilation). Une fois
   corrigé, le simple `app.enableCors({ origin })` d'origine fonctionnait très bien.
2. **`apps/api`'s tests Vitest injectaient `this.projectsService`/`this.prisma` à `undefined`.**
   Vitest transforme le TypeScript via esbuild, qui n'émet pas `emitDecoratorMetadata` — NestJS
   ne peut alors plus résoudre l'injection de dépendances par réflexion de type en test (fonctionne
   très bien en production via `nest build`, qui utilise `tsc`). Fixé avec un transform SWC
   (`apps/api/vitest.config.ts` + `unplugin-swc`).
3. **`POST /workflows/:id/executions` (sans corps) plantait avec `Body cannot be empty when
   content-type is set to 'application/json'`.** `apiRequest` (client HTTP de `apps/web`) posait
   systématiquement `content-type: application/json`, y compris pour les requêtes sans corps —
   Fastify rejette ce cas précis. Fixé en ne posant l'en-tête que lorsque `init.body` est fourni.

Point n°2 a aussi révélé un piège ESLint : `@typescript-eslint/consistent-type-imports` propose de
convertir en `import type` des imports de service/contrôleur qui, du point de vue statique
d'ESLint, ne sont "utilisés qu'en position de type" — mais NestJS a besoin que ces imports restent
des imports de *valeur* pour que `emitDecoratorMetadata` référence la vraie classe au runtime.
`apps/api/eslint.config.mjs` désactive cette règle pour tout le package, avec l'explication en
commentaire.

### Correctifs post-itération 3 — `pnpm dev` cassé sur environnement neuf

Signalé par un utilisateur lançant `pnpm dev` pour la première fois (pas seulement moi, qui avait
toujours `.env` déjà chargé à la main dans mon shell pendant tout le développement — ce qui
masquait le premier des deux bugs ci-dessous). Deux causes réelles, indépendantes :

1. **Aucun mécanisme ne chargeait `.env` automatiquement.** `apps/api` (NestJS/`ConfigModule`),
   `apps/worker` et les scripts Prisma de `packages/database` lisent `process.env` directement ;
   sans un shell l'ayant déjà exporté, `DATABASE_URL`/`REDIS_HOST`/... sont `undefined`. Fixé en
   enveloppant leurs scripts `dev`/`start`/`test` (et les scripts Prisma nécessitant une connexion
   réelle) avec `dotenv-cli`, pointé explicitement sur le `.env` racine
   (`dotenv -e ../../.env -- ...`) — fonctionne quel que soit le dossier depuis lequel
   Turborepo/pnpm exécute le script. `apps/web` n'était pas concerné (Vite charge déjà `.env` via
   `envDir` dans `vite.config.ts`). **Ne crée jamais de `.env` dupliqué dans un sous-dossier**
   (`apps/api/.env`, etc.) pour contourner ce genre de symptôme — un seul `.env`, à la racine, sinon
   les deux copies finissent par diverger silencieusement.
2. **Race condition dans `tsup --watch`.** Chaque `tsup.config.ts` de package avait `clean: true`
   inconditionnel. En mode `dev`, la tâche `dev` de Turborepo ne dépendait pas de `^build` : les 10
   packages/apps démarraient leur watcher en parallèle, et `tsup --watch` supprime `dist/` à
   *chaque* démarrage — y compris juste après qu'un autre package venait de lire ce même `dist/`
   (résolution de module workspace pnpm), provoquant des `Cannot find module .../dist/index.js`
   ou `Could not find a declaration file` transitoires et non déterministes. Fixé par deux
   changements complémentaires : `turbo.json` fait maintenant dépendre `dev` de `^build` (un build
   complet une fois, avant que les watchers ne démarrent) ; et chaque `tsup.config.ts` n'active
   `clean` qu'en dehors du mode watch (`clean: !options.watch`, via la forme fonction de
   `defineConfig`).

Par ailleurs, `pnpm dev` lance 10 tâches persistantes (une par package/app ayant un script `dev`),
soit exactement la limite de concurrence par défaut de Turborepo (10) — `turbo.json` déclare donc
`"concurrency": "11"` pour laisser une marge.

**Vérifié** : `pnpm dev` et `pnpm test` passent tous les deux sur un état complètement neuf
(`dist/` et cache Turborepo supprimés, `.env` jamais sourcé manuellement dans le shell).

### Données d'exemple au premier lancement (`packages/database/prisma/seed.ts`)

`pnpm db:migrate` (première migration en dev) crée maintenant automatiquement un projet
d'exemple **"Veille e-commerce"** avec deux workflows réalistes et directement exécutables
(`http` → `extract` → `setVariable` → `condition` → `stop`×2), ciblant une vraie API publique
stable (`fakestoreapi.com`) plutôt qu'un fixture local — l'exemple reste utilisable même après la
fin d'une session de développement.

Point technique notable : `prisma migrate dev` n'a **pas** déclenché le hook de seed automatique
de Prisma lors du test (base de données neuve, migrations déjà présentes dans le dépôt à
appliquer) — seul `prisma migrate reset --force` le fait de façon fiable dans cette version de
Prisma. Plutôt que de dépendre de cette heuristique interne, `migrate:dev` chaîne explicitement
`prisma migrate dev && pnpm run seed` dans `packages/database/package.json`. Le seed est idempotent
(id fixes préfixés `seed-`, `upsert` avec `update: {}`) : le rejouer à chaque `pnpm db:migrate` ne
crée jamais de doublon et ne réécrase jamais une modification faite depuis l'UI. `migrate:deploy`
(usage prod/CI) n'appelle jamais le seed.

## Itération 4 — Preview HTML + sélection visuelle d'éléments (livrée)

Le point 3 de la feuille de route ci-dessous (§6, §8) : depuis un node `http` en
`responseType: "html"` avec une URL définie, l'éditeur propose désormais de prévisualiser la page
réellement rendue par le site cible, de cliquer un élément, d'obtenir plusieurs sélecteurs
candidats notés par robustesse, et de valider pour créer un node `extract` relié — sans jamais
exécuter le script du site cible dans l'application.

| Zone | Contenu |
|---|---|
| `apps/api/src/tools/` | `POST /tools/preview-html` (interpole l'URL/en-têtes/paramètres avec les variables globales du projet via `@datarover/expression-engine`, fait la requête via `undici`, timeout 10s, plafond 5 Mo), `POST /tools/test-selector` (délègue tel quel à `extractWithCss`/`scoreSelector` de `@datarover/extractor`), et `GET /tools/preview-asset` (voir bug n°1 ci-dessous) — aucun des trois ne touche `@datarover/workflow-core` : l'API continue de ne jamais exécuter le moteur (§17.6) |
| `src/lib/htmlSandbox.ts` | Nettoyage `DOMParser` du HTML récupéré avant injection dans l'iframe : retrait de tout `<script>`, attribut d'événement inline (`onclick`, ...), URL `javascript:`, `<meta http-equiv="refresh">` ; réécriture de chaque `<img src>`/`srcset` vers `/tools/preview-asset` (voir bug n°1) ; injection d'un `<base href>` (URL résolue renvoyée par le backend) pour tout le reste ; un unique script *que nous écrivons* est ajouté ensuite pour le survol/clic et le calcul côté client des sélecteurs candidats (`data-*`, id, classe propre, classe-parent + classe-propre, chemin positionnel de repli ancré sur le plus proche ancêtre stable — voir bug n°3) |
| `src/components/HtmlPreviewSelector.tsx` | La modale (plein écran, voir bug n°2) : iframe `sandbox="allow-scripts"` **sans** `allow-same-origin` (origine opaque) à gauche, panneau de score/validation à droite (réutilise le score renvoyé par le vrai `scoreSelector`, pas une heuristique dupliquée) ; plusieurs règles peuvent être accumulées avant "Terminer" |
| `HttpNodeInspector` / `NodeInspectorPanel` / `WorkflowEditorPage` | Bouton "Prévisualiser & sélectionner" visible quand `responseType === "html"` et `url` non vide ; validation → nouveau node `extract` (`source` = le node http, `sourceType: "html"`) créé et relié par une edge, sélectionné automatiquement — même conventions `generateNodeId`/`createDefaultNode` que les autres ajouts de node |

### Quatre bugs/limites réels trouvés et corrigés après la première livraison de l'itération 4

1. **Les images de la page prévisualisée ne s'affichaient pas.** Reproduit avec un vrai site
   e-commerce (signalé par l'utilisateur) via Firefox piloté par Selenium : les `<img>` atteignaient `complete: true`
   mais `naturalWidth: 0` (chargement silencieusement échoué). Isolé la cause exacte avant de
   corriger : ce n'est pas le sandboxing en lui-même (vérifié isolément — une image d'un CDN
   permissif se charge très bien dans un iframe `sandbox="allow-scripts"` sans
   `allow-same-origin`) ; c'est le CDN du site cible qui bloque des requêtes d'image faites depuis
   le contexte de l'iframe (protection anti-hotlink/anti-scraping côté CDN, comportement propre à
   chaque site). Le même `undici`, exécuté côté backend, récupère pourtant ces mêmes images sans
   problème (vérifié directement). Fixé en ajoutant `GET /tools/preview-asset?url=...` : chaque
   `<img src>`/`srcset` de l'aperçu est réécrit pour passer par ce proxy backend plutôt que de
   charger directement depuis le site cible — fiable quel que soit le mécanisme de blocage du site,
   puisque c'est le même client HTTP serveur qui a déjà réussi à récupérer la page elle-même.
   Limite connue documentée dans le code : les images posées en CSS (`background-image: url(...)`)
   ne sont pas encore réécrites, seules les vraies balises `<img>`.
2. **La popup de prévisualisation était trop petite** (`max-w-6xl`, soit 1152px max, quelle que soit
   la taille de l'écran). Fixée pour occuper toute la largeur/hauteur de la fenêtre (marge de 0,5rem
   conservée pour la lisibilité du cadre).
3. **Cliquer un `<div>` générique (sans `id`/`data-*`/classe "propre") n'affichait aucun "Aperçu du
   résultat".** Reproduit avec un vrai fixture reprenant le cas signalé : une page uniquement faite
   de `<div>` (aucune balise `p`), stylée avec des classes façon CSS-modules/styled-components
   (`ProductDescription_body__a3f92`) — exactement le style de markup des sites pilotés par un
   framework composant, qui n'utilisent quasiment jamais de balises sémantiques. Cause : le filtre
   `isCleanClass` du script de picking (`htmlSandbox.ts`) rejette ces classes "hashées" (trop
   longues ou pleines de chiffres) de la liste des candidats, ne laissant que le chemin positionnel
   de repli — bien plus fragile. Fixé par deux changements : (a) un nouveau candidat propose
   toujours la classe complète telle quelle, même "moche"/hashée, plutôt que rien ; (b) le chemin
   positionnel de repli (`anchoredPathSelector`) s'ancre désormais sur le plus proche ancêtre ayant
   un `id` OU **n'importe quelle** classe (plus seulement une classe "propre"), au lieu de toujours
   remonter jusqu'à `<body>` — un chemin plus court est nécessairement plus robuste. Vérifié avec un
   test dédié reproduisant exactement ce cas : le nouveau candidat `.ProductDescription_body__a3f92`
   apparaît et l'aperçu affiche bien le texte du bloc.
4. **Les sélecteurs candidats n'étaient que des boutons en lecture seule.** Quand l'auto-détection
   ne trouve rien de satisfaisant (cas n°3 ci-dessus, ou toute autre page atypique), il n'y avait
   aucun moyen de s'en sortir depuis l'interface. Fixé : chaque candidat est maintenant un champ
   texte éditable, re-testé automatiquement contre l'API (debounce 400 ms) à chaque modification —
   un bouton "+ ajouter" permet aussi d'écrire un sélecteur entièrement à la main. "Ajouter cette
   règle" n'est activable que si au moins un candidat correspond réellement (`matchedSelector`),
   et la règle créée regroupe désormais **tous** les candidats actuellement valides comme chaîne de
   repli ordonnée par score — pas seulement le premier — ce qui correspond exactement à la sémantique
   de `ExtractionRule.selectors`.

Vérifié à nouveau contre le même site réel après le correctif des images/de la taille (mêmes outils,
Selenium + inspection DOM réelle) : 67 images sur 67 chargées (`naturalWidth > 0`, 0 cassée), et la
modale mesure 1572×882 dans une fenêtre de 1600×914 (plein écran, marge de cadrage seulement). Le
scénario e2e navigateur committé (`apps/web/e2e/htmlPreview.e2e.test.ts`) couvre maintenant aussi
l'édition en direct d'un candidat (cassé à la main → badge "non correspondant" après le debounce,
sans perdre l'aperçu du candidat toujours valide).

### Rendu JavaScript pour les pages React/Vue/etc. dont le contenu réel n'existe qu'après script

Signalé sur une vraie page (une "focus promo" d'un site e-commerce, en React) : cliquer un élément
n'affichait jamais rien de pertinent. Diagnostic direct (pas une supposition) : le HTML brut récupéré
par `preview-html` ne contenait **aucune balise `<h1>`**, et l'état JSON embarqué dans la page
avait un objet `"product": {}` vide, même avec un User-Agent "Googlebot" — le contenu réel de cette
page n'existe tout simplement pas dans le HTML servi, il n'apparaît qu'après exécution du JS
React côté client. Or l'outil de preview ne peut pas, par principe, exécuter le JS du site cible
dans l'application (voir modèle de sécurité ci-dessous) — il n'y avait donc littéralement rien de
réel à cliquer.

Ajout d'une case "Rendu JavaScript" (décochée par défaut — plus lente, GET uniquement) dans la
modale de preview : quand elle est activée, `POST /tools/preview-html` (`render: true`) délègue à
`BrowserRendererService` (`apps/api/src/tools/browser-renderer.service.ts`), qui exécute le JS de
la page dans un **vrai navigateur headless, dans un processus disposable séparé** (piloté via
`playwright-core`, sans lui faire télécharger/gérer son propre Chromium — cet environnement n'a pas
le `sudo` nécessaire pour ses dépendances système ; on pilote plutôt le Chrome déjà installé sur la
machine, résolu via `CHROME_EXECUTABLE_PATH` ou des chemins standards, voir `chromeBinary.ts`). Le
JS du site cible ne tourne **jamais** dans ce process Node ni dans le frontend — seul le DOM
résultant (`page.content()`, du texte HTML inerte) est renvoyé, et il retraverse exactement le
même pipeline de sanitisation (`buildSandboxedDocument`) qu'un fetch brut. Ceci ne concerne que
l'outil de preview interactif : l'exécuteur `http` du moteur reste strictement HTTP (Undici), une
exécution de workflow ne rend jamais de JS.

**Bandeau de consentement cookies bloquant tout le rendu.** Premier test réel sur la page
signalée : le rendu s'exécutait bien, mais une capture d'écran a montré qu'un bandeau
plein-écran (Cookiebot, dans ce cas précis) recouvrait tout le contenu réel — présent dans le DOM
mais invisible et non cliquable derrière l'overlay. `BrowserRendererService.dismissConsentBanner`
tente maintenant de le fermer avant de capturer le DOM : une liste de sélecteurs des CMP les plus
courants (Didomi, OneTrust, Quantcast, Cookiebot) essayés **en parallèle** (pas séquentiellement —
un CMP peut prendre plusieurs secondes à s'initialiser, et essayer les sélecteurs un par un aurait
épuisé le budget de temps sur ceux qui ne correspondent jamais avant même d'atteindre le bon), puis
un repli générique par texte du bouton ("j'accepte", "tout accepter", "accept all", ...) si aucun
des sélecteurs connus ne correspond. Best-effort et jamais bloquant : un bandeau non fermé donne
juste un aperçu qui montre encore le bandeau, jamais un échec du rendu.

**Vérifié** : deux tests e2e API dédiés (`apps/api/test/tools.e2e.test.ts`) contre des fixtures
locales — un fetch brut d'une page dont le contenu n'apparaît qu'après un script (le fetch brut ne
le voit pas, `render: true` le capture) et une page avec un faux bandeau plein-écran (fermé avant
capture). Revérifié ensuite contre la page réelle signalée, avec capture d'écran de l'aperçu
obtenu : le bandeau Cookiebot a disparu et la page réelle (navigation, panier, grille de produits
"Moulinet Avid Carp...", prix, boutons "Acheter") s'affiche entièrement.

**Modèle de sécurité de la prévisualisation** (répond à l'exigence explicite de §6) : la
communication iframe → parent passe exclusivement par `postMessage`, vérifiée côté parent via
`event.source === iframe.contentWindow` (jamais `event.origin`, qui vaut `"null"` pour une origine
opaque) ; chaque clic dans l'aperçu appelle `preventDefault`/`stopPropagation` en phase de capture,
donc aucune navigation ni soumission de formulaire ne peut s'échapper de l'aperçu.

**Vérifié** : `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` verts (305
tests, dont les 13 tests e2e API de `apps/api/test/tools.e2e.test.ts` — `preview-asset` et le rendu
JavaScript compris, chacun contre un serveur de fixture HTTP local réel — et les 13 tests
unitaires de `htmlSandbox.ts`).
Parcours complet
dans un vrai navigateur (Firefox headless), formalisé en scénario e2e committé
(`apps/web/e2e/htmlPreview.e2e.test.ts`, inclus dans `pnpm test:e2e`) : création d'un node HTTP
pointé vers un vrai serveur de fixture local → ouverture de l'aperçu → **clic réel** sur un élément
à l'intérieur de l'iframe sandboxée (bascule de contexte WebDriver dans le frame) → les sélecteurs
candidats affichés correspondent exactement à l'exemple du cahier des charges
(`[data-testid="title"]`, `.title`, `.product-card .title`) avec un score cohérent → validation → un
node `extract` apparaît, relié au node http, avec la règle validée → sauvegarde réussie.

## Explicitement hors périmètre à ce stade

- **WebSocket temps réel** (§17.12) — le moteur émet déjà des événements (`onEvent`) et le worker
  persiste des `ExecutionLog` au fil de l'exécution ; l'UI actuelle les affiche par polling (1s),
  pas de relais en direct.
- **Scheduler exécutable** (§14) — les types `Schedule`/`ScheduleType` existent, mais ni table
  Prisma, ni cron, ni endpoint, ni UI.
- **Browser crawling / Playwright pour l'exécution des workflows** (§5, §17.9) — le moteur
  (`packages/workflow-core`, exécuteur `http`) reste strictement HTTP (Undici). Un rendu headless
  Playwright existe désormais, mais uniquement pour l'outil de preview interactif de l'éditeur (voir
  itération 4, "Rendu JavaScript") — une exécution de workflow réelle ne rend jamais de JS.
- **`FOR EACH` / `WHILE`** (§9.5) — explicitement V2 dans le cahier des charges (§25).
- **Sorties** Webhook/Database/CSV (§9.6) — V2 (§25).
- **XPath** comme stratégie d'extraction — le type existe, l'exécution lève une erreur explicite
  « planned for V2 ».
- **Credentials/Auth**, **Docker complet** (web/api/worker/browser-worker containerisés, §19-21),
  **application Electron** (§17.3, §24) — seul un `docker-compose.yml` minimal (postgres+redis) est
  fourni.
- **Drag-and-drop riche, undo/redo, mise en page persistée** dans l'éditeur visuel — la position
  des nodes est recalculée à chaque chargement (voir itération 3 ci-dessus), pas sauvegardée.

## Prochaines itérations (proposition, non engageante)

1. ~~Backend exécutable~~ — livré (itération 2).
2. ~~UI minimale~~ — livrée (itération 3).
3. ~~Preview HTML + sélection visuelle~~ — livrée (itération 4).
4. **Scheduler exécutable**, puis **Docker complet** (containerisation de
   `web`/`api`/`worker`/`browser-worker`) et **coquille Electron**, dans l'esprit de la section 24
   (MVP v1).

## Comment vérifier

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate   # une fois
cp .env.example .env
docker compose up -d postgres redis     # ou: pnpm infra:up
pnpm install                             # génère aussi le client Prisma
pnpm db:migrate                          # première migration (interactif la 1ère fois : --name init)
pnpm build
pnpm test        # 305 tests Vitest (unitaires + intégration moteur + e2e api/worker sur vrai Postgres/Redis)
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
