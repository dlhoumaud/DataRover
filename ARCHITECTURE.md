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
`Credential` (§17.5) n'étaient **pas** créés à cette itération — ils appartenaient aux itérations
scheduler/auth, non demandées à l'époque. `Schedule` est livré depuis (itération 7, voir plus bas :
`POST`/`GET /workflows/:id/schedules`, `PATCH`/`DELETE /schedules/:id`) ; `Credential` reste hors
périmètre.

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
scénario e2e navigateur committé (`apps/web/e2e/preview.e2e.test.ts`) couvre maintenant aussi
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
(`apps/web/e2e/preview.e2e.test.ts`, inclus dans `pnpm test:e2e`) : création d'un node HTTP
pointé vers un vrai serveur de fixture local → ouverture de l'aperçu → **clic réel** sur un élément
à l'intérieur de l'iframe sandboxée (bascule de contexte WebDriver dans le frame) → les sélecteurs
candidats affichés correspondent exactement à l'exemple du cahier des charges
(`[data-testid="title"]`, `.title`, `.product-card .title`) avec un score cohérent → validation → un
node `extract` apparaît, relié au node http, avec la règle validée → sauvegarde réussie.

## Itération 5 — Nodes de traitement de texte, code couleur de la palette, menu contextuel (livrée)

| Zone | Contenu |
|---|---|
| `packages/workflow-types/src/action.ts` | Deux nouveaux types de node, chacun une **pipeline d'opérations** appliquées dans l'ordre (`input`, un `{{ }}` interpolé — même convention que `ExtractNode.source`) : `dataTransform` ("Traitement" dans l'éditeur — voir la refonte entrée/sortie ci-dessous) et `textCrypto` — voir le détail complet des algorithmes ci-dessous |
| `packages/workflow-core/src/executors/{dataTransformExecutor,textCryptoExecutor}.ts` | Exécuteurs correspondants — opérations pures/synchrones (aucun I/O, donc pas de `timeoutMs`/`retryPolicy` sur ces nodes) ; `textCrypto` n'utilise que le module `crypto` natif de Node ; `dataTransform` s'appuie sur `fast-xml-parser`/`jsonpath-plus` (déjà utilisés par `@datarover/extractor`) et `yaml` (nouvelle dépendance) |
| `apps/web/src/lib/nodeStyles.ts` | Source unique des couleurs/labels par type de node, partagée par le node du canvas (`WorkflowNode.tsx`) et les boutons de la palette (`NodePalette.tsx`) — la palette affiche désormais le même point de couleur que le node qu'elle crée, faisant office de légende |
| `apps/web/src/components/inspectors/{DataTransformNodeInspector,TextCryptoNodeInspector}.tsx` | Formulaires d'édition de la pipeline (ajout/suppression/réordonnancement implicite par position, champs spécifiques à chaque type d'opération affichés dynamiquement) |
| `apps/web/src/components/NodeContextMenu.tsx` + câblage dans `WorkflowEditorPage.tsx` | Menu contextuel personnalisé (React Flow n'en fournit pas) sur clic droit d'un node : Dupliquer (nouvel id via `generateNodeId`, position décalée, sélectionné automatiquement) et Supprimer (retire aussi les edges qui le référencent) — fermeture au clic extérieur, à `Échap`, ou après une action |

**Vérifié** : 337 tests Vitest (`packages/workflow-types` +10, `packages/workflow-core` +20 pour les
deux exécuteurs — hachages contre des vecteurs de test connus, chiffrement/déchiffrement
aller-retour, IV aléatoire par appel — `apps/web` +2). Preuve d'exécution bout en bout réelle (pas
seulement des tests unitaires isolés) : un workflow réel `setVariable → textTransform → textCrypto
→ stop` créé via l'API, exécuté par le worker, dont la sortie de chaque node a été vérifiée
indépendamment (`"  Produit Génial  "` → `"produit-génial"` → hash SHA-256 recalculé à la main et
comparé bit à bit). Nouveau scénario e2e navigateur committé
(`apps/web/e2e/nodeContextMenu.e2e.test.ts`) : tous les boutons de la palette ont un point de
couleur, les deux nouveaux nodes s'ajoutent et s'éditent, le clic droit ouvre le menu, "Dupliquer"
crée un node distinct (id différent, vérifié via l'attribut `data-id` de React Flow) et "Supprimer"
ne retire que le node ciblé. Un vrai bug de script de test (pas de l'application) a été trouvé et
corrigé en cours de route : réutiliser le même générateur d'actions Selenium pour deux clics droits
successifs pouvait rejouer/empiler l'état du pointeur et faire atterrir le second clic droit sur le
mauvais node — corrigé en recréant un générateur d'actions à chaque geste.

### Éditeur en plein écran + extension de `textCrypto` (hash, chiffrement, encodage)

**L'éditeur de workflow (React Flow + son en-tête/palette) occupe désormais toute la largeur et
hauteur de la fenêtre.** `Layout.tsx` enveloppait chaque page dans une colonne centrée
`max-w-5xl` avec du padding — adapté aux pages de contenu, pas à un canevas. `Layout` détecte
maintenant la route de l'éditeur (`/projects/:id/workflows/:id`, via `useLocation`, sans avoir à
faire remonter une prop à travers `App.tsx`) et ne lui applique ni la largeur max, ni le padding,
ni le scroll de page (`h-screen overflow-hidden` + `flex-1 min-h-0` plutôt que `min-h-screen`) —
les autres pages ne sont pas affectées (vérifié : largeur de leur `<main>` inchangée).

Ce changement a révélé un vrai bug latent dans `NodeContextMenu` : sans scroll de page possible,
un menu contextuel ouvert près du bord bas/droit de la fenêtre pouvait se positionner
**partiellement hors écran et devenir totalement inatteignable** (avant, un défilement de page
accidentel le "sauvait"). Fixé en mesurant la taille réelle du menu après montage
(`useLayoutEffect`) et en recalant sa position pour qu'il reste entièrement dans le viewport.

**`textCrypto` couvrait trop peu d'algorithmes** (uniquement md5/sha1/sha256/sha512 pour `hash`,
AES-256-CBC pour `encrypt`/`decrypt`, aucun encodage URL). Chaque algorithme ajouté a été vérifié
disponible sur ce build Node (`crypto.getHashes()`/`crypto.getCiphers()`) avant d'être proposé —
DES simple, RC4 et Blowfish sont volontairement absents : OpenSSL 3 les désactive par défaut (ils
n'apparaissaient même pas comme disponibles), et ce sont de toute façon des chiffrements cassés.

- **`hash`** : + sha224, sha384, sha3-224/256/384/512, ripemd160, blake2b512, blake2s256.
- **`encrypt`/`decrypt`** : nouveau champ `algorithm` (optionnel — absent, il vaut
  implicitement `aes-256-cbc`, pour que les workflows sauvegardés avant ce champ continuent de se
  parser sans modification) parmi aes-128/192/256-cbc, aes-128/192/256-gcm, des-ede3-cbc (3DES) et
  chacha20-poly1305. La dérivation de clé passe de `sha256(passphrase)` à `scrypt` (memory-hard,
  volontairement lent) — nettement plus résistant au brute-force d'une passphrase faible — et gère
  désormais des longueurs de clé variables (16/24/32 octets) selon l'algorithme. Pour les
  algorithmes authentifiés (GCM, chacha20-poly1305) le tag d'authentification est calculé/vérifié
  (`getAuthTag`/`setAuthTag`) et embarqué dans la sortie base64 aux côtés de l'IV — un texte
  chiffré altéré est rejeté explicitement au déchiffrement (propriété vérifiée par un test dédié).
- **RSA (asymétrique)**, ajouté comme deux opérations à part — `rsaEncrypt` (clé publique PEM) et
  `rsaDecrypt` (clé privée PEM) — plutôt que forcé dans la forme "passphrase" des chiffrements
  symétriques, puisque ce n'est ni la même famille cryptographique ni la même UX (pas de
  passphrase, une paire de clés). RSA-OAEP/SHA-256 via `crypto.publicEncrypt`/`privateDecrypt` ;
  la taille du texte source est bornée par la taille de la clé (≈190 octets pour 2048 bits), une
  entrée trop longue lève une erreur Node explicite plutôt que d'être tronquée silencieusement.
- **`encode`/`decode`** : + `url` (`encodeURIComponent`/`decodeURIComponent` — un cas à part,
  géré spécifiquement dans l'exécuteur puisque ce n'est pas un encodage `Buffer`).

**Vérifié** : 363 tests Vitest (+26 : `packages/workflow-types` pour les nouveaux schémas,
`packages/workflow-core` pour les exécuteurs — vecteurs de test connus pour chaque nouveau hash,
aller-retour chiffrement/déchiffrement pour chaque nouveau chiffrement symétrique, rejet d'un
texte chiffré altéré en GCM, rejet d'un déchiffrement avec un algorithme différent de celui du
chiffrement, aller-retour RSA avec une vraie paire de clés générée pour le test, rejet d'un texte
trop long pour RSA, aller-retour url encode/decode). Preuve d'exécution bout en bout réelle : un
workflow `setVariable → textCrypto(url encode) → textCrypto(AES-256-GCM encrypt) →
textCrypto(AES-256-GCM decrypt) → textCrypto(url decode) → textCrypto(RSA encrypt) →
textCrypto(RSA decrypt) → stop` créé via l'API et exécuté par le vrai worker, avec une vraie paire
de clés RSA générée pour l'occasion — chaque sortie intermédiaire vérifiée, le texte ressort
identique à l'original après le aller-retour complet.

### Le node "Texte" devient "Traitement" : entrée/sortie typées, plus un vrai bug XML trouvé au passage

Renommé `textTransform` → `dataTransform` (littéral interne ; libellé affiché "Traitement" —
choisi par l'utilisateur parmi "Traitement"/"Flux"/"Payload"), et étendu avec :

- **`inputType`** (`raw`/`json`/`yaml`/`xml`) : détermine comment `input` est interprété avant la
  pipeline. Si la valeur interpolée est déjà une valeur JS non-string (un node `http` amont en
  `responseType: "json"` transmet déjà un objet/tableau parsé, jamais une chaîne re-encodée — voir
  httpExecutor.ts), elle est utilisée telle quelle ; sinon elle est parsée (`JSON.parse`, le
  package `yaml`, ou `fast-xml-parser`).
- **`outputType`** (`text`/`list`/`table`/`int`/`float`/`boolean`) : une étape de coercition finale
  (pas une simple étiquette) normalise systématiquement la sortie vers ce type, quel que soit ce
  que la pipeline a produit — utile en particulier pour `getPath`, dont le type de résultat n'est
  pas connu statiquement. `table` produit un tableau d'objets-lignes (encapsulant si besoin
  chaque scalaire, ou les entrées d'un objet) — distinct de `list`, qui garantit seulement un
  tableau sans remodeler son contenu.
- **Catalogue d'opérations selon `inputType`** : `raw` propose les opérations texte existantes
  (lower…padEnd) ; `json`/`yaml`/`xml` proposent des opérations sur la valeur parsée (`getPath` en
  JSONPath — même syntaxe que le node Extraction —, `keys`, `values`, `toArray`, `length`,
  `stringify`) ; `toInt`/`toFloat`/`toBoolean` sont proposées dans tous les cas.
- **Type de sortie automatique** : l'inspecteur met à jour `outputType` dès que le type de la
  *dernière* opération de la pipeline change (ex : sélectionner `toInt` en dernière étape passe
  la sortie sur "Entier"), reste ensuite un champ normal, modifiable à la main.

**Vrai bug pré-existant trouvé en construisant cette fonctionnalité (pas introduit par elle) :**
`fast-xml-parser` utilise par défaut le préfixe `"@_"` pour les attributs XML, mais `jsonpath-plus`
(utilisé par CHAQUE sélecteur JSONPath de l'app, y compris ceux du node `extract` déjà livré)
traite un `@` isolé comme son propre symbole "nœud courant" — vérifié directement que
`$.item['@_id']` lève une exception à l'intérieur de `jsonpath-plus` dès que `item` désigne un
objet unique plutôt qu'un tableau (un élément XML qui ne se répète pas). Le seul test existant
(`xmlExtractor.test.ts`) n'exerçait qu'un élément répété (`product[0]['@_id']`), qui contourne le
bug par hasard — l'accès par index de tableau ne déclenche jamais le problème, seul l'accès direct
à un objet le fait. Concrètement : le node `extract` existant, pointé sur `sourceType: "xml"`, n'a
**jamais** correctement extrait l'attribut d'un élément XML non répété via JSONPath — l'échec était
silencieux (`value: undefined`, sans erreur visible). Corrigé dans `xmlExtractor.ts` (utilisé par
`extract`) et `dataTransformExecutor.ts` en changeant le préfixe pour `"attr_"` — sans `@`, aucune
collision possible, confirmé pour les deux formes (objet unique et tableau). Test de régression
ajouté pour le cas non-tableau, en plus du test existant corrigé.

**Vérifié** : 374 tests Vitest (+11 : `packages/extractor` pour le bug XML corrigé,
`packages/workflow-types` pour le nouveau schéma, `packages/workflow-core` pour l'exécuteur —
JSON/YAML/XML, `getPath` sur un élément XML unique, coercition vers chaque type de sortie).
Vérification visuelle réelle (Firefox piloté par Selenium) : la palette affiche "+ Traitement", le
catalogue d'opérations change bien selon le type d'entrée sélectionné (14 options en mode brut,
9 en mode JSON), et le type de sortie se met à jour automatiquement à la sélection de la dernière
opération. Preuve d'exécution bout en bout réelle : un workflow `setVariable → dataTransform(JSON,
getPath, float) → dataTransform(YAML, getPath, float) → dataTransform(XML, getPath sur un
attribut d'élément unique, text) → dataTransform(JSON, getPath vers un tableau, table) → stop`
créé via l'API et exécuté par le vrai worker — chaque sortie intermédiaire correcte, y compris
l'attribut XML sur l'élément unique qui aurait échoué avant le correctif.

## Itération 6 — Preview JSON/XML, node Boucle, palette sans "+" (livrée)

### Preview & sélection étendue au JSON/XML (Specs.md §6/§8, au-delà du HTML)

Le même outil que l'itération 4 (bouton "Prévisualiser" sur un node `http`) fonctionne désormais
pour `responseType: "json"` et `"xml"`, pas seulement `"html"` — masqué uniquement pour `"file"`
(binaire, rien à afficher). `HtmlPreviewSelector.tsx` est renommé `PreviewSelector.tsx` (son rôle
dépasse maintenant le HTML) et branche son rendu par `sourceType` :

- **HTML** : inchangé — iframe sandboxée (voir itération 4).
- **JSON/XML** : un nouveau composant `JsonTreeView.tsx` (React pur, aucun sandboxing nécessaire —
  il ne rend jamais de HTML/script venant du site cible, seulement des valeurs JS en texte) affiche
  un arbre colorisé (clés en indigo, chaînes en vert, nombres en bleu, booléens en violet, `null`
  en gris italique) et repliable (▸/▾, chaque conteneur replié par défaut à partir de 2 niveaux de
  profondeur, pour ne pas afficher des milliers de nœuds ouverts sur un vrai payload). Le XML est
  parsé côté client avec `fast-xml-parser` (mêmes options que `xmlExtractor.ts` — préfixe `attr_`,
  voir itération 5) uniquement pour l'affichage ; la source brute envoyée au backend pour tester un
  sélecteur reste le texte XML original, jamais re-sérialisé, pour rester fidèle à une vraie
  exécution.
- **Clic sur un élément** : pour le HTML, inchangé (`postMessage` depuis l'iframe). Pour le
  JSON/XML, `JsonTreeView` appelle directement `onSelect(path, value)` (même document, pas
  d'iframe) ; `lib/jsonPath.ts` (nouveau) construit le JSONPath canonique correspondant
  (`buildJsonPath(["items", 0, "price"])` → `"$.items[0].price"`). Contrairement aux sélecteurs CSS
  (ambigus, donc plusieurs candidats scorés), un JSONPath dans un document concret est exactement
  déterministe : un seul chemin, pas un ensemble de candidats à départager — c'est ce que l'outil
  calcule ici, pas un score.

Backend : `POST /tools/test-selector` renomme son champ `html` en `source` et ajoute `sourceType`
(`html`/`json`/`xml`, défaut `html`), et délègue à `extractWithJsonPath`/`extractWithXml` de
`@datarover/extractor` (déjà utilisés par le node `extract`) plutôt que de dupliquer une logique
parallèle — la prévisualisation reste ainsi rigoureusement fidèle à ce qu'une vraie exécution
produirait, exactement comme pour le CSS en itération 4.

**Vérifié** : 406 tests Vitest au total dans le monorepo (+16 côté `apps/api` pour le nouveau
dispatch JSON/XML de `test-selector`, +12 côté `apps/web` pour `buildJsonPath` et `JsonTreeView`).
Nouveau scénario e2e navigateur committé (`apps/web/e2e/preview.e2e.test.ts`, renommé depuis
`htmlPreview.e2e.test.ts`) : pointer un node HTTP vers une vraie réponse JSON, ouvrir l'aperçu,
déplier un nœud replié par défaut, cliquer une valeur, vérifier que le candidat calculé est bien le
JSONPath canonique (`$.items[0].price`), valider la règle, et confirmer qu'un node `extract` avec
`sourceType: "json"` apparaît relié — en plus du scénario HTML existant, toujours vert.

### Node "Boucle" — itération sur une liste/un tableau (Specs.md §9.5, "FOR EACH", scopé)

- **`packages/workflow-types/src/action.ts`** : `LoopNodeSchema` (`type: "loop"`, `source` — un
  `{{ }}` interpolé, même convention que `dataTransform.input`/`http.url`, qui doit s'évaluer en
  tableau — et `outputMode: "list" | "last"`, défaut `"list"`) porte un **corps intégré** :
  `body: LoopBodyNodeSchema[]` (min. 1), une petite séquence ordonnée d'étapes stockée directement
  sur le node, plutôt qu'un sous-graphe visible avec une boucle de rappel — choix délibéré (validé
  avec l'utilisateur) pour ne toucher à rien dans la détection de cycles/le parcours du moteur
  (`validateDefinition`, `getNextNodeId`, `DEFAULT_MAX_STEPS`) : une boucle n'introduit ainsi
  jamais un vrai cycle dans le graphe lui-même. `LoopBodyNodeSchema` exclut délibérément
  `condition` (pas de cible de branchement dans une séquence linéaire), `stop` (terminerait tout le
  workflow en pleine itération, jamais l'intention) et `loop` (pas de boucle imbriquée dans cette
  itération).
- **Liaison par itération** : chaque étape du corps voit `{{ item }}` (l'élément courant) et
  `{{ runtime.index }}` / `{{ runtime.isFirst }}` / `{{ runtime.isLast }}` — des emplacements déjà
  prévus et génériquement résolus par `@datarover/expression-engine` (`ExpressionContext.item`/
  `.runtime`, déjà documentés avant même ce node), donc aucune modification du moteur d'expressions
  n'a été nécessaire. Pas de nom de variable configurable : toute étape du corps lit l'élément
  courant via le nom fixe `item`, de la même façon qu'un node lit les sorties précédentes via le
  nom fixe `actions`.
- **`packages/workflow-core/src/executors/types.ts`** : `NodeExecutionContext` gagne un champ
  optionnel `runNode` — permet à un exécuteur de faire re-tourner un autre node à travers le
  dispatch d'exécuteurs du moteur lui-même, sans le dupliquer. Optionnel spécifiquement pour ne pas
  avoir à modifier les fixtures `NodeExecutionContext` des exécuteurs existants qui n'en ont pas
  besoin.
- **`packages/workflow-core/src/engine.ts`** : `runNode` est câblé dans `WorkflowEngine.run()`,
  fermé sur son propre registre d'exécuteurs, en réutilisant exactement `withRetry`/`withTimeout` —
  une étape du corps profite donc de son propre `timeoutMs`/`retryPolicy` comme n'importe quel
  node.
- **`packages/workflow-core/src/executors/loopExecutor.ts`** : interpole `source`, exige un vrai
  tableau (sinon erreur explicite — une source qui ne s'évalue pas en tableau est presque
  certainement une erreur de configuration, pas un cas à absorber silencieusement). Chaque
  itération obtient un bucket `actionsOutput` **isolé** (initialisé à partir d'une copie de celui
  du scope englobant, pour que les étapes du corps puissent toujours lire les sorties des nodes
  précédents, puis alimenté au fil des étapes de cette même itération) — rien n'en ressort jamais
  vers le scope englobant : seule la sortie globale du node `loop` lui-même traverse la frontière,
  ce qui évite qu'un node en aval ait à deviner "la sortie de quelle itération" une étape du corps
  désignerait. `variables` (les buckets `global`/`project`/`workflow`), en revanche, est la même
  référence mutable que le scope englobant : une étape `setVariable` du corps s'accumule donc à
  travers les itérations et reste visible après la boucle, exactement comme un `setVariable`
  n'importe où ailleurs dans le graphe.
- **`apps/web/src/components/inspectors/LoopNodeInspector.tsx`** : édite `name`/`source`/
  `outputMode`, plus un éditeur du corps — chaque étape se replie/déplie et, dépliée, réutilise
  **le même composant d'inspection que ce type de node utilise partout ailleurs dans l'éditeur**
  (`HttpNodeInspector`, `ExtractNodeInspector`, ...), pas une réimplémentation. Deux coupes de
  périmètre délibérées : `HttpNodeInspector` s'utilise ici sans `projectId`/`onCreateExtractNode`
  (les deux désormais optionnels — le bouton "Prévisualiser" ne s'affiche simplement pas, câbler le
  flux preview→extract récursivement dans un corps de boucle imbriqué est hors périmètre) ; et
  `ExtractNodeInspector.availableNodeIds` n'expose que les étapes **précédentes** du corps (ordre
  séquentiel, jamais une étape pas encore exécutée). Étapes ajoutables/supprimables (jusqu'au
  minimum d'une imposé par le schéma), non réordonnables — position figée, coupe de périmètre
  explicite.

**Vérifié** : `packages/workflow-core` passe de 82 à 92 tests (+9 `loopExecutor.test.ts` : tableau
vide, source non-tableau rejetée, liaison item/runtime, accumulation d'une variable `workflow.*` à
travers les itérations via une étape `setVariable` du corps, une étape lisant la sortie d'une étape
précédente de la même itération, `outputMode` "list" vs "last", `runNode` manquant détecté ; +1 cas
d'intégration dans `engine.test.ts` prouvant le câblage réel de `runNode` — pas seulement contre un
double de test — de bout en bout via le vrai `WorkflowEngine.run()`), `packages/workflow-types` de
58 à 65 (schéma, corps vide/invalide rejeté, chaque type de node explicitement exclu du corps
rejeté individuellement). Nouveau scénario e2e navigateur committé
(`apps/web/e2e/loopNode.e2e.test.ts`) : création d'un node `loop` via la palette, réglage de
`source` sur une variable globale du projet, dépliage/édition de l'étape par défaut du corps (une
`setVariable` imbriquée, prouvant que la composition récursive d'inspecteurs fonctionne dans un
vrai navigateur), sauvegarde, puis **rechargement complet de la page** et re-vérification que
chaque champ a bien traversé l'aller-retour API.

**Limite pré-existante découverte en écrivant ce scénario (pas introduite par cette itération) :**
l'éditeur ne propose aucun moyen de changer le `startNodeId` d'un workflow après sa création — il
reste figé sur le node `stop` créé par défaut à la création du workflow, quel que soit ce qu'on
ajoute ensuite sur le canevas. `workflow.e2e.test.ts` (itération 3) contournait déjà silencieusement
cette limite (son commentaire l'assume explicitement) : le node `http` qu'il configure n'est en
réalité jamais exécuté, seul le `stop` par défaut l'est. Pour cette raison, `loopNode.e2e.test.ts`
vérifie la création/configuration/persistance via l'UI plutôt qu'une exécution réussie en
navigateur ; la preuve d'exécution réelle du node `loop` (liaison item/runtime, modes de sortie, le
corps qui tourne réellement étape par étape) vit à la place dans `engine.test.ts`/
`loopExecutor.test.ts` ci-dessus. Corriger cette limite (un sélecteur de node de départ dans
l'éditeur) est hors périmètre de cette itération.

### Panneau d'inspection redimensionnable

`NodeInspectorPanel` avait une largeur fixe (`w-80`, 320px) — trop étroit pour éditer confortablement
un node `loop` (corps intégré imbriqué) ou un node `http` avec beaucoup d'en-têtes. Un nouveau hook
réutilisable, `apps/web/src/lib/useResizableWidth.ts`, gère le glisser-déposer d'une poignée
(pointer events, pas de dépendance externe) : la poignée est sur le bord **gauche** du panneau
(ancré à droite du layout), donc la faire glisser vers la gauche l'élargit. Largeur bornée
(280–720px, défaut 320 — identique au comportement précédent) et persistée en `localStorage`
(écrite une seule fois, au relâchement du pointeur — pas à chaque pixel pendant le glissement).

**Vérifié** : 9 tests unitaires du hook (largeur par défaut/persistée/bornée/invalide, direction du
glissement, persistance uniquement au relâchement, aucune réaction après la fin du glissement) +
nouveau scénario e2e navigateur (`apps/web/e2e/inspectorPanelResize.e2e.test.ts`) : glissement réel
de 100px vers la gauche via `driver.actions()`, largeur du panneau effectivement mesurée avant/après
(`offsetWidth`), puis rechargement complet de la page confirmant la persistance.

### Palette : suppression du préfixe "+"

`NodePalette.tsx` affichait chaque bouton comme `+ {label}` (`+ HTTP`, `+ Traitement`, ...) — retiré
(le point de couleur devant chaque libellé suffit à signaler "ceci ajoute un node"). Les sélecteurs
Selenium qui ciblaient le texte exact (`nodeContextMenu.e2e.test.ts`) ont été mis à jour en
conséquence.

## Itération 7 — Scheduler exécutable (livrée)

Les types `Schedule`/`ScheduleType` existaient déjà (Specs.md §14) ; cette itération les rend
réellement exécutables : table Prisma, endpoints CRUD, déclenchement réel via BullMQ, UI.

Architecture logique, en reprenant exactement le schéma de §14 :

```text
Schedule (Postgres)
    ↓ upsertJobScheduler (apps/api)
BullMQ job scheduler ("workflow-schedule-triggers")
    ↓ tick (à l'heure due)
apps/worker : processScheduleTrigger → crée un Execution "pending"
    ↓ enqueueExecution
BullMQ ("workflow-executions") — la queue existante, inchangée
    ↓
apps/worker : processExecutionJob (déjà livré, itération 2) → WorkflowEngine.run
```

- **`packages/database/prisma/schema.prisma`** : nouveau modèle `Schedule` (`type` — enum Prisma
  natif `manual|interval|hourly|daily|weekly|cron`, mêmes valeurs que le `ScheduleType` Zod déjà
  existant —, `everyMinutes`/`cronExpression` optionnels, `enabled`), relié à `Workflow` avec
  `onDelete: Cascade`. `type: "manual"` et `enabled: false` signifient tous les deux "ne se
  déclenche jamais tout seul" — la différence est purement l'intention de l'utilisateur (un choix
  explicite "pas de planification" contre une pause temporaire) ; apps/api n'enregistre un job
  scheduler BullMQ que pour une ligne à la fois activée et non `manual`.
- **`packages/queue`** : nouvelle queue `SCHEDULE_TRIGGER_QUEUE_NAME`
  (`"workflow-schedule-triggers"`), distincte de la queue d'exécution existante — les deux formes
  de job n'ont rien en commun (un tick de planification n'a pas encore d'`Execution`).
- **`apps/api/src/schedules/`** : `POST`/`GET /workflows/:workflowId/schedules`,
  `PATCH`/`DELETE /schedules/:id`. La validation Zod (`dto.ts`) exige `everyMinutes` pour
  `interval` et une `cronExpression` qui **parse réellement** pour `cron` — vérifiée avec
  `cron-parser`, épinglé à la même version exacte que celle dont dépend `bullmq` en interne, pour
  que ce qui est accepté ici soit garanti accepté par BullMQ ensuite. `hourly`/`daily`/`weekly` se
  traduisent en motifs cron fixes calés sur l'horloge murale (`0 * * * *`, `0 0 * * *`,
  `0 0 * * 0` — schedule-repeat.ts) plutôt qu'un "toutes les N ms depuis maintenant", qui dériverait
  à chaque redémarrage du serveur. `SchedulesService` n'écrit jamais d'`Execution` ni n'exécute le
  moteur — seulement la ligne `Schedule` et le *job scheduler* BullMQ associé (`upsertJobScheduler`/
  `removeJobScheduler`, une primitive BullMQ 5.x dédiée exactement à ce cas : un déclencheur
  récurrent identifié par une clé stable, ici l'id du `Schedule`).
- **Nettoyage cross-cutting** : supprimer un `Workflow` (ou un `Project`, qui cascade à travers
  tous ses workflows) supprime bien les lignes `Schedule` via `ON DELETE CASCADE` côté Postgres,
  mais Postgres n'a aucun moyen d'aller nettoyer l'état BullMQ correspondant côté Redis. Corrigé en
  appelant `SchedulesService.removeAllJobSchedulersFor{Workflow,Project}` avant chaque suppression
  (`WorkflowsService.remove`/`ProjectsService.remove`) — sans quoi un job scheduler orphelin
  continuerait de créer des `Execution` pour un workflow qui n'existe plus.
- **`apps/worker/src/processScheduleTrigger.ts`** : consomme la queue de déclenchement, crée un
  `Execution` "pending" et l'enfile sur la queue d'exécution existante — exactement le chemin que
  prend un clic manuel sur "Exécuter" (`ExecutionsService.createForWorkflow`), simplement déclenché
  par un tick BullMQ plutôt qu'une requête HTTP. Tolère explicitement la course entre un tick déjà
  en vol et une planification désactivée/supprimée entre-temps (comportement normal, pas une
  erreur) en passant son tour silencieusement plutôt que de lever.
- **`apps/web/src/components/SchedulesPanel.tsx`** : bouton "⏱ Planification" dans l'en-tête de
  l'éditeur — liste les planifications du workflow ouvert, case à cocher "Actif" par ligne,
  formulaire d'ajout dont les champs changent selon le type choisi. Modifier le type/les paramètres
  d'une planification existante n'est pas supporté (mirroring `UpdateScheduleSchema`, qui n'accepte
  que `enabled`) — changer la récurrence signifie supprimer puis recréer.

**Vérifié** : 436 tests Vitest au total dans le monorepo (+16 `apps/api` : 6 pour
`schedule-repeat.ts`, 10 e2e contre un vrai Postgres/Redis — dont la lecture directe de l'état
BullMQ via `queue.getJobScheduler()` pour prouver que l'API enregistre réellement le bon motif, pas
seulement qu'elle répond 201 — et +5 `apps/worker`, dont un test qui fait **réellement tourner** un
`Worker`/`Queue` BullMQ en direct avec un intervalle de 2 secondes et attend le vrai déclenchement,
plutôt que d'appeler la fonction directement). Nouveau scénario e2e navigateur committé
(`apps/web/e2e/schedules.e2e.test.ts`) : ajout d'une planification "toutes les 15 minutes",
activation/désactivation réelle, rejet d'une expression cron invalide avec message d'erreur visible,
ajout d'une planification cron valide, suppression, puis **rechargement complet de la page**
confirmant la persistance côté serveur.

**Un vrai bug de script de test trouvé pendant la vérification** (pas dans l'application) : le
test "tourne pour de vrai" de `processScheduleTrigger.test.ts` utilisait d'abord la queue de
production `SCHEDULE_TRIGGER_QUEUE_NAME` — un vrai process `apps/worker` de développement tournant
en parallèle sur le même Redis (l'environnement de vérification manuelle de ce même tour) lui volait
alors la moitié des jobs (BullMQ ne livre un job qu'à un seul consommateur parmi tous ceux qui
écoutent une queue), faisant échouer le test de façon intermittente sans que le code testé soit en
cause. Corrigé en isolant ce test sur un nom de queue jetable (`processScheduleTrigger` lui-même ne
sait pas, et n'a pas besoin de savoir, quelle queue a livré le job).

## Itération 8 — Docker complet (livrée)

`docker compose up --build` (la commande cible exacte de Specs.md §19) démarre désormais
l'environnement complet — `web`, `api`, `worker`, `browser-worker`, `postgres`, `redis` — sur un
seul réseau Docker, sans étape manuelle (migrations comprises).

### `browser-worker` devient un vrai service séparé

Jusqu'ici, le rendu JavaScript de l'outil de preview (itération 4) tournait **dans le processus
`apps/api`** (`BrowserRendererService`, Playwright). Specs.md §19-20 exige explicitement que
`browser-worker` soit un service à part, séparé du worker HTTP, précisément pour qu'un rendu
lent/bloqué/planté ne puisse jamais affecter autre chose que lui-même — une exigence que
"tourner dans le même processus que le reste de l'API" ne satisfaisait pas, containerisation ou
non. Extrait dans une nouvelle app **`apps/browser-worker`** : un micro-service NestJS+Fastify
avec une seule route (`POST /render`), qui reprend le code de rendu existant tel quel
(`chromeBinary.ts`, la logique de rendu/dismissal de bandeau cookies — inchangée). `apps/api` ne
dépend plus de `playwright-core` du tout (supprimé de son `package.json`) : son
`BrowserWorkerClient` (`apps/api/src/tools/browser-worker.client.ts`) appelle ce service par HTTP
(`BROWSER_WORKER_URL`, `undici`), et traduit ses erreurs exactement comme le faisait l'ancien code
in-process.

**Bénéfice inattendu, découvert en migrant les tests** : `apps/api/test/tools.e2e.test.ts` n'a
plus besoin d'un vrai Chrome pour ses propres tests — seulement d'un faux `browser-worker` (un
simple serveur HTTP fixture, comme pour n'importe quel autre test e2e de ce fichier), puisque
driver un vrai navigateur est désormais la responsabilité exclusive de
`apps/browser-worker/test/render.e2e.test.ts` (qui, lui, garde une vraie vérification contre un
vrai Chrome — bandeau de consentement compris). Toute la suite `apps/api` est passée de ~10s à
~0.3s d'exécution, sans perdre la moindre couverture : c'est un signe que le découpage suit bien
une frontière de responsabilité réelle, pas seulement une frontière de déploiement.

### Un seul `Dockerfile` (et un seul `Dockerfile.dev`) pour les quatre services Node

Specs.md §21 demande explicitement un unique `Dockerfile`/`Dockerfile.dev` (noms au singulier),
pas un par service. Réalisé via le patron officiellement recommandé par Turborepo pour ce cas —
`turbo prune <package> --docker`, qui réduit le monorepo à la seule sous-arborescence dont ce
service a réellement besoin (déterminé depuis le graphe de dépendances réel, jamais à la main) —
puis une image finale choisie par `--target` : `runner` (Node nu, `api`/`worker`), `runner-browser-
worker` (`runner` + un vrai Chromium Alpine), `runner-web` (nginx servant le build statique de
`apps/web`), et `runner-migrate` (`prisma migrate deploy`, un job unique qui s'arrête après avoir
appliqué les migrations en attente — `api`/`worker` attendent explicitement sa réussite avant de
démarrer, donc un tout premier `docker compose up --build` sur une base vide n'a besoin d'aucune
étape manuelle).

**Deux vrais pièges du patron `turbo prune` rencontrés en le faisant fonctionner pour de vrai**
(aucun des deux n'est mentionné dans la documentation Turborepo elle-même) :
1. `out/json` (la couche mise en cache dès que les *dépendances* changent, avant même de copier le
   vrai code source) ne contient que des `package.json` — mais `packages/database` a son propre
   script `postinstall: prisma generate`, qui a besoin du fichier `schema.prisma` réel, absent à
   ce stade. Corrigé en installant avec `--ignore-scripts` à cette étape, puis en rejouant tous les
   scripts d'installation (`pnpm rebuild`) une fois `out/full` (le vrai code source) copié.
2. `out/full` ne contient que les fichiers appartenant aux packages *inclus* dans l'élagage — pas
   les fichiers à la racine du monorepo dont ils dépendent quand même (`tsconfig.base.json`, dont
   hérite le `tsconfig.json` de chaque package). Corrigé en les copiant explicitement dans l'image
   après `out/full`.

### `apps/web` : servi par nginx (prod), servi par Vite (dev) — jamais par `node dist/main.js`

Seul service statique du lot. `runner-web` construit `apps/web/dist` (Vite) puis le sert via
nginx (`docker/nginx.conf` — `try_files ... /index.html` pour le fallback SPA du routeur
client, sans quoi un rechargement sur `/projects/abc` renverrait un 404 nginx plutôt que de laisser
react-router prendre le relais). Piège classique des SPA en Docker, explicitement contourné :
`VITE_API_URL` est **inliné dans le JS au moment du build de l'image** (Vite n'a aucune
configuration "au runtime" pour une SPA statique) — il doit donc pointer vers l'adresse qu'un
**navigateur sur la machine hôte** peut atteindre (le port publié de `api`, ex.
`http://localhost:3001`), jamais vers le nom de service interne au réseau Docker
(`http://api:3001`, injoignable depuis l'extérieur du réseau Docker).

### Mode développement (`docker-compose.dev.yml`)

`docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` : chaque service Node
tourne via son `pnpm --filter <pkg> dev` habituel (hot reload nest/tsx/vite) au lieu d'un
`dist/main.js` compilé, avec le dépôt monté en volume — modifier un fichier sur l'hôte se répercute
immédiatement dans le conteneur. Un volume anonyme sur `/app/node_modules` (un seul, pas un par
package) masque spécifiquement la racine `node_modules` du montage bind — suffisant parce que le
`node_modules` de chaque package de l'espace de travail n'est, chez pnpm, qu'un lien symbolique
relatif vers ce magasin racine ; il se résout donc correctement vers la copie du conteneur sans
avoir besoin de son propre volume dédié.

**Vérifié** : les 5 images (`migrate`, `api`, `worker`, `browser-worker`, `web`) se construisent et
`docker compose up --build` démarre les 6 services avec succès (`api`/`browser-worker` rapportent
`healthy` sur leur `/health`, `migrate` s'arrête à 0). Preuve d'exécution bout en bout réelle, à
travers la stack **entièrement containerisée** (pas de raccourci vers un process local) : création
d'un projet → d'un workflow → déclenchement d'une exécution → le `worker` (son propre conteneur)
la traite et la fait passer à `success` ; et séparément, un aperçu avec rendu JavaScript
(`render: true`) traverse réellement `api` → `browser-worker` → un vrai Chromium dans son propre
conteneur, réseau Docker interne compris (résolution DNS du nom de service `browser-worker` vérifiée
directement). La suite e2e navigateur existante (`apps/web/e2e/`) a été rejouée sans modification
contre la stack containerisée : 5 des 7 scénarios passent tels quels ; les 2 restants
(`preview.e2e.test.ts`) échouent pour une raison attendue et documentée, pas un bug — ils démarrent
un serveur de fixture local lié à `127.0.0.1` côté hôte, injoignable depuis le conteneur `api`
(`127.0.0.1`, vu de l'intérieur d'un conteneur, désigne sa propre boucle locale, jamais celle de
l'hôte) ; ces deux tests restent la référence pour l'usage normal (`pnpm test:e2e` contre la stack
lancée via `pnpm dev`), pas contre la stack containerisée. 443 tests Vitest au total dans le
monorepo (+7 `apps/browser-worker`).

**Un vrai bug de process trouvé pendant la vérification** (pas dans le code applicatif) : plusieurs
`nest start --watch`/`tsx watch` de développement local, accumulés au fil des redémarrages successifs
de cette session, tournaient encore en tâche de fond et se disputaient les mêmes ports/queues avec
les conteneurs Docker — nettoyés avant de lancer `docker compose up`.

## Itération 9 — Node "Navigateur" (`browserAction`) : exécution batch (Phase A, livrée)

Nouveau type de node, à la demande explicite de l'utilisateur : comme `http`, mais pilotant un
**vrai navigateur Playwright** (clics, frappe clavier caractère-par-caractère, survol, glisser-
déposer, défilement) pour les sites qui n'exposent leur vrai contenu qu'après une interaction
réelle. **Ceci lève partiellement**, et de façon délibérée, l'entrée "Browser crawling / Playwright
pour l'exécution des workflows" de la section précédente : le moteur d'exécution
(`packages/workflow-core`) exécute désormais réellement du JS via un navigateur piloté, pour ce
type de node précisément — l'exécuteur `http` lui-même reste strictement HTTP (Undici), inchangé.

**Uniquement la moitié "batch" pour l'instant** — pas encore la preview live interactive avec
enregistrement des actions de l'utilisateur, qui reste une pièce séparée (voir la nouvelle entrée
hors périmètre ci-dessous) : ce node se configure aujourd'hui en éditant sa liste d'actions à la
main dans l'inspecteur, sans preview.

- **Schéma** (`packages/workflow-types/src/action.ts`) : `BrowserActionNodeSchema`
  (`startUrl` + `steps: BrowserActionStepSchema[]`) — onze variantes de step
  (`navigate`/`click`/`type`/`press`/`select`/`hover`/`dragTo`/`scrollIntoView`/`scrollPage`/
  `wait`/`waitForSelector`). `type` documente explicitement qu'il doit rester une frappe
  caractère-par-caractère (`page.locator().pressSequentially`), jamais `page.fill` — c'est
  précisément la raison d'être de ce node face à `http`. `retryPolicy` est **omis du schéma** via
  `.omit({ retryPolicy: true }).strict()` (pas juste laissé optionnel) : le moteur rejoue
  l'exécuteur entier en cas de retry, ce qui rejouerait toute la séquence — y compris un clic
  "soumettre" déjà réussi. `.strict()` est ce qui rend cet omission réellement bloquante plutôt que
  cosmétique (sans lui, `z.object` accepterait puis ignorerait silencieusement un `retryPolicy`
  fourni malgré tout). `LoopBodyNodeSchema` ne l'inclut pas non plus (scope cut explicite — voir
  son propre commentaire).
- **`apps/browser-worker`** : nouvelle route `POST /session/run` (module `src/session/`), calquée
  sur `/render` existant. **Lance son propre navigateur Chromium dédié par appel**, plutôt que de
  réutiliser le singleton partagé de `RenderService` : cette route peut être longue (plusieurs
  étapes) et est appelée par de vraies exécutions, potentiellement sans surveillance — la coexistence
  avec l'outil de preview interactif sur un seul processus navigateur aurait dilué la garantie
  d'isolation qui est la raison d'être même de ce service. Coût accepté : un lancement Chromium par
  appel (~1-2s).
- **Garde-fou SSRF** (`ssrfGuard.ts`, nouveau) sur cette route (et sur chaque step `navigate`) :
  résout la cible et rejette (400) une adresse privée/loopback/link-local, sauf allowlist explicite
  via `BROWSER_WORKER_SSRF_ALLOWLIST`. Justifié spécifiquement pour ce node (pas pour `/render`,
  volontairement non retouché) : `startUrl`/`navigate.url` sont interpolés depuis des données
  potentiellement issues du scraping lui-même, et ce node peut tourner sans surveillance via le
  scheduler — un vrai navigateur qui **exécute le JS** d'une cible interne est un risque plus large
  qu'un simple fetch HTTP. Explicitement best-effort (plages courantes seulement, pas le registre
  IANA complet) et ne protège pas contre une redirection vers une cible privée après coup.
- **`packages/workflow-core`** : `browserActionExecutor.ts`, calque direct de `httpExecutor.ts` —
  interpole `startUrl` et chaque champ templaté de `steps`, un seul appel HTTP batch vers
  `browser-worker` (jamais via `apps/api` : exactement comme `httpExecutor` ne passe jamais par
  `apps/api` non plus). `engine.ts` gagne un accesseur `getRetryPolicy(node)` dédié, nécessaire
  parce qu'un accès direct à `node.retryPolicy` ne type-check plus une fois qu'un membre de l'union
  (`browserAction`) n'a plus ce champ du tout.
- **Frontend** : inspecteur dédié (liste d'actions éditable, calque du patron
  `TextCryptoNodeInspector.tsx`) enregistré sur tous les points d'extension habituels
  (`nodeStyles.ts`, `NodePalette.tsx`, `WorkflowNode.tsx`, `NodeInspectorPanel.tsx`,
  `workflowGraph.ts`) — sans encore de bouton de preview live (Phase C, à venir).
- **`docker-compose.yml`/`docker-compose.dev.yml`** : `worker` gagne `BROWSER_WORKER_URL` (déjà
  présent sur `api` depuis l'itération 8) — c'est désormais lui, pas seulement `api`, qui a besoin
  de joindre `browser-worker`.

**Vérifié** : tests Zod du nouveau schéma (dont le rejet de `retryPolicy`) ; tests unitaires du
garde-fou SSRF (adresses privées v4/v6, allowlist) ; `browserActionExecutor.test.ts` (interpolation,
appel HTTP, propagation d'erreur) contre un vrai serveur HTTP fixture ; nouveau
`apps/browser-worker/test/session.e2e.test.ts` contre un vrai Chrome (frappe + clic réels, suivi
d'un `navigate`, rejet SSRF, sélecteur introuvable) ; suite complète du monorepo rejouée sans
régression (`pnpm turbo run build typecheck lint test`, 35/35 puis 18/18 tâches réussies).

### Deux bugs réels trouvés et corrigés après la livraison initiale de la Phase A

Signalés par l'utilisateur ("le node n'enregistre pas les propriétés") — pas un problème Docker/
config, deux bugs distincts dans `BrowserActionNodeInspector.tsx`, tous deux couverts par de
nouveaux tests de composant (premiers de ce type dans ce dépôt — aucun inspecteur n'en avait avant) :

1. Le step par défaut d'un nouveau node/d'une nouvelle action (`{ type: "click", selector: "" }`)
   n'était pas valide (sélecteur vide) — or la sauvegarde exige que **toutes** les actions soient
   valides avant d'écrire quoi que ce soit, y compris le nom ou l'URL de départ (même patron que
   `TextCryptoNodeInspector`). Un node fraîchement créé ne sauvegardait donc littéralement rien
   jusqu'à ce que ce premier champ soit rempli. Corrigé en changeant ce step par défaut pour `wait`
   (`workflowGraph.ts`'s `createDefaultNode`, et le bouton "+ ajouter une action") — le seul type de
   step valide sans qu'aucun champ texte soit rempli.
2. Plus subtil : même après (1), un node dont l'état de départ était déjà invalide (ex. un node
   créé avant ce correctif) ne se sauvegardait toujours pas une fois l'utilisateur corrigeait le
   champ manquant. Cause : le garde-fou anti-doublon (`lastSentRef`, censé éviter un appel `onChange`
   parasite au montage) ne s'initialisait qu'au premier *parse réussi* — si ce premier succès
   survient à cause d'une vraie modification (et non au montage), il était avalé à tort comme s'il
   s'agissait juste de l'écho initial. Corrigé en initialisant `lastSentRef` directement avec le
   node reçu en prop, plutôt qu'avec `null` en attendant le premier succès.

### Actions supplémentaires pour simuler un comportement humain (à la demande explicite de l'utilisateur)

Trois ajouts aux steps de `BrowserActionStepSchema`, tous rejouables avec un délai qui peut être
**aléatoire** (tiré à nouveau à chaque exécution, via un nouveau `DelaySpecSchema` partagé — `{kind:
"fixed", ms}` ou `{kind: "random", minMs, maxMs}`) plutôt que fixe, précisément parce qu'un délai
identique à chaque rejeu ne lit pas comme humain :

- `moveMouse` (`x`, `y`, `delay?`) — déplace la souris vers une position absolue de la fenêtre.
- `moveMouseRandom` (`delay?`) — déplace la souris vers une position aléatoire de la fenêtre
  visible (jitter d'inactivité, sans viser un élément précis).
- `type` : son délai inter-frappe (`delayMs: number` avant) devient `delay?: DelaySpec` — un délai
  `"random"` ici n'a pas d'équivalent natif dans Playwright (`pressSequentially` n'accepte qu'un
  seul délai constant), donc ce cas précis tape caractère par caractère à la main
  (`page.keyboard.type`) avec une pause ré-échantillonnée après chacune, plutôt que de déléguer à
  `pressSequentially`.

Les deux nouveaux steps de déplacement utilisent `page.mouse.move(x, y, { steps: 15 })` (pas 1, le
défaut Playwright) pour produire un déplacement visuellement progressif plutôt qu'un saut instantané
— une constante interne, pas un champ exposé à l'utilisateur (hors périmètre de la demande).

**Vérifié** : tests Zod (dont le rejet d'un `DelaySpec` random avec `maxMs < minMs`) ;
`browserActionExecutor.test.ts` (les nouveaux champs sont bien numériques/structurels, jamais
interpolés) ; `session.e2e.test.ts` contre un vrai Chrome (position de souris exacte confirmée via
un `mousemove` écouté côté page fixture, frappe à délai aléatoire produisant toujours le texte
correct) ; 8 nouveaux tests de composant pour la nouvelle UI de délai (fixe/aléatoire) sur les
trois steps concernés. `pnpm turbo run build typecheck lint test` rejoué sans régression (46/46).

### Un vrai bug produit trouvé — aucun moyen de choisir le nœud de départ d'un workflow

Signalé par l'utilisateur ("j'ai branché un browserAction à un Stop mais seul le Stop est
exécuté") — **pas un bug du node `browserAction` en particulier** : un workflow tout juste créé
démarre toujours comme un unique nœud `stop` (`ProjectDetailPage.tsx`'s `handleCreateWorkflow`,
`startNodeId: "stop1"`), et **rien dans l'éditeur ne permettait de désigner un autre nœud comme
point de départ** — ajouter un nœud, ou le relier par une flèche, ne touchait jamais
`startNodeId`. Un `browserAction` câblé en amont de `stop1` restait donc bien branché visuellement,
mais jamais atteint : le moteur démarre à `startNodeId`, et un nœud `stop` interrompt le parcours
avant même de regarder ses arêtes sortantes (`engine.ts`) — aucune notion de "regarder les arêtes
entrantes" ou "exécuter tout `definition.nodes`" n'existe. `validateDefinition` ne vérifie que la
présence des ids référencés, jamais l'atteignabilité — un nœud orphelin ou mal câblé passe la
validation et s'exécute silencieusement sans jamais tourner.

Corrigé par deux ajouts, tous deux nouveaux dans l'éditeur :
- **Désigner le nœud de départ** : nouvel item "Définir comme nœud de départ" dans le menu
  contextuel (`NodeContextMenu.tsx` ; affiché "✓ Nœud de départ", non cliquable, sur le nœud déjà
  désigné), et un badge visuel "▶ Départ" sur ce nœud (`WorkflowNode.tsx`). `startNodeId` migre
  de "lu directement depuis la définition chargée, jamais modifiable" vers un champ mutable de
  `useEditorStore` (même patron que `selectedNodeId`) — c'est ce qui permet à `WorkflowNode` de le
  lire directement pour son badge, sans le faire transiter par les props `data` de chaque node
  React Flow. Supprimer le nœud de départ réassigne automatiquement un autre nœud restant
  (`reassignStartNodeId`, `lib/workflowGraph.ts`) plutôt que de laisser un `startNodeId` pendant
  qui casserait la validation au prochain enregistrement.
- **Garde-fou avant exécution** : "Exécuter" calcule désormais (`findUnreachableNodeIds`,
  BFS depuis `startNodeId` sur les arêtes actuelles — la même logique que celle qu'`autoLayout`
  utilise déjà pour placer les nœuds orphelins, extraite ici) et avertit (confirmation, non
  bloquant) si des nœuds ne seront jamais exécutés depuis le nœud de départ actuel — pour que ce
  cas précis ne redevienne plus jamais silencieux.

**Vérifié** : 4 tests unitaires purs pour `reassignStartNodeId`/`findUnreachableNodeIds` (dont le
scénario exact du bug rapporté : `browserAction1 -> stop1` avec `startNodeId = "stop1"`) ;
`nodeContextMenu.e2e.test.ts` étendu contre un vrai Firefox — désigne un nœud comme départ, confirme
le badge et le nouvel état du menu contextuel ; `workflow.e2e.test.ts` mis à jour (accepte
désormais la boîte de dialogue de confirmation, puisque son propre workflow de test avait
toujours ce défaut précis — sans jamais le vérifier). `pnpm turbo run build typecheck lint test`
(46/46) puis la suite e2e navigateur rejouées sans régression (hors `preview.e2e.test.ts`, déjà
documenté itération 8 comme incompatible avec la stack containerisée pour une raison sans rapport).

### Un vrai bug d'environnement trouvé — schéma partagé resté en mémoire côté `api`/`worker`

Signalé par l'utilisateur ("l'enregistrement ne fonctionne pas sur certaines actions") après les
ajouts `moveMouse`/`moveMouseRandom`/`delay`. Un balayage exhaustif des 13 variantes de step de
l'inspecteur (nouveaux tests de composant, un par type + un scénario multi-étapes) n'a rien trouvé
côté formulaire — chacune se sauvegarde correctement isolément. Reproduit directement contre l'API
réelle (`curl` avec un node `browserAction` contenant un step `moveMouse`) : rejeté avec
`invalid_union_discriminator`, alors que le schéma sur disque accepte bien ce type.

Cause : `docker compose ps` montrait `api`/`worker` `Up 2 hours`, sans redémarrage depuis avant ces
ajouts au schéma. `nest start --watch` (`api`) et `tsx watch` (`worker`) ne surveillent que leur
propre `src/`, jamais le `dist/` d'un package workspace dont ils dépendent
(`packages/workflow-types`) — le fichier compilé est bien à jour sur disque (montage en direct),
mais le process déjà démarré garde en mémoire le schéma chargé à SON propre démarrage
(`require`/`import` ne relit jamais un module déjà chargé). Les variantes déjà présentes AVANT ces
ajouts continuaient donc à s'enregistrer normalement ; seules les nouvelles (`moveMouse`,
`moveMouseRandom`, `type.delay`) étaient rejetées — exactement le symptôme "certaines actions".

Corrigé par un simple `docker compose restart api worker` (aucun rebuild d'image nécessaire) ; la
même requête `curl` accepte ensuite les trois nouveaux steps. Documenté dans le README comme un
troisième cas, distinct des deux autres pièges Docker déjà notés (image jamais reconstruite / mode
production sans montage) : modifier un package partagé pendant qu'un service qui en dépend tourne
déjà nécessite un `restart` de ce service, sans quoi son schéma en mémoire reste silencieusement
périmé malgré des fichiers à jour sur disque.

## Variables de sortie affichées + autocomplétion `{{ }}` (à la demande explicite de l'utilisateur)

Deux ajouts liés, pour rendre le chaînage des nodes moins dépendant de la mémoire/de la
documentation :

- **Panneau d'inspection** (`NodeInspectorPanel.tsx`) : affiche désormais, pour **tout** type de
  node, la liste de ses références `{{ }}` valides une fois qu'il a tourné — pas seulement
  `actions.<id>.output`, mais chacun de ses sous-champs statiquement connus (`http` →
  `.status`/`.headers`/`.body` ; `browserAction` → `.status`/`.html` ; `stop` →
  `.stopped`/`.reason` ; `extract` → un sous-champ par nom de règle **configurée sur ce node** ;
  aucun sous-champ connu pour `condition`/`dataTransform`/`textCrypto`/`loop`, qui n'affichent que
  la référence de base). `setVariable` est un cas à part : affiche `workflow.<clé>` — la
  convention que ce dépôt utilise déjà partout (voir `setVariableExecutor.ts` : chaque clé finit
  dans `ctx.variables.workflow`), pas le générique `actions.<id>.output.<clé>` qui marcherait
  aussi mais introduirait une deuxième façon, non conventionnelle, de lire la même valeur. Un
  clic copie la référence complète (`{{ ... }}`) dans le presse-papiers.
- **Autocomplétion** (`TemplateInput.tsx`, nouveau) : tout champ `{{ }}` de l'éditeur (URL/en-
  têtes/paramètres/corps HTTP, `startUrl` et les champs textuels de chaque action du node
  Navigateur, la donnée source de Traitement/Crypto, les valeurs de Variables, la source d'une
  Boucle) affiche désormais une liste déroulante filtrée dès que l'utilisateur tape `{{` —
  reprend exactement la même liste de références que ci-dessus, pour chaque node du graphe, plus
  `global.<clé>` pour chaque variable globale déclarée sur le projet, plus (uniquement à
  l'intérieur du corps d'une Boucle) `item`/`runtime.index`/`runtime.isFirst`/`runtime.isLast`.
  Techniquement : un `<input>`/`<textarea>` toujours enregistré normalement via
  `register(name)` de react-hook-form (aucun champ n'est devenu "contrôlé") — l'insertion d'une
  suggestion passe par le même mécanisme que les extensions de navigateur/outils d'automatisation
  utilisent pour simuler une vraie frappe sur un champ non contrôlé (le setter natif de
  `HTMLInputElement.prototype.value`, puis un événement `input` synthétique), puisque
  `registration.onChange` ne réagit jamais à une simple mutation d'état React.
- **Périmètre volontairement pas couvert** : le champ `expression` du node Condition (une
  expression JS-like évaluée directement, jamais un template `{{ }}` — voir
  `evaluateCondition`) ; les champs de règle d'Extraction (sélecteurs/nom/attribut — utilisés
  comme littéraux, jamais interpolés) ; le `source` d'Extraction lui-même, qui est déjà un
  `<select>` d'ids de nodes existants, pas un champ texte.

**Vérifié** : 18 tests unitaires purs pour `lib/templateVariables.ts` (dont le scénario exact
`browserAction1`/`http1` avec sous-champs, et le cas `setVariable` → `workflow.<clé>`) ; 7 tests de
composant pour `TemplateInput` (ouverture sur `{{`, filtrage, fermeture, insertion, navigation
clavier, mode `textarea`) ; nouveau test e2e navigateur réel
(`templateAutocomplete.e2e.test.ts`) — tape `{{ coun` dans le champ URL d'un node HTTP, voit
`workflow.count` proposé (défini par un node Variables ajouté juste avant), clique, confirme
`{{ workflow.count }}`. `nodeContextMenu`/`workflow`/`loopNode.e2e.test.ts` rejoués sans
régression — `loopNode.e2e.test.ts` a dû être ajusté : son XPath supposait le champ "Source"
directement adjacent à son `<label>`, une hypothèse cassée par le nouveau `<div>` d'enrobage de
`TemplateInput`. `pnpm turbo run build typecheck lint test` (46/46).

### Un vrai bug trouvé en testant l'affichage des variables : `stopExecutor.ts` n'interpolait jamais `reason`

Signalé par l'utilisateur, qui avait mis `{{ actions.browserAction1.output.html }}` dans le
`reason` d'un node Stop et voyait cette chaîne littérale dans le résultat d'exécution au lieu de la
vraie valeur. Cause : contrairement à **tous** les autres exécuteurs (`httpExecutor.ts`'s `url`,
`dataTransformExecutor.ts`/`textCryptoExecutor.ts`'s `input`, `setVariableExecutor.ts`'s valeurs,
`browserActionExecutor.ts`'s champs de step), `stopExecutor.ts` renvoyait `node.reason` tel quel,
sans jamais appeler `interpolate()`. Passé inaperçu depuis la toute première itération : `reason`
est optionnel et le plus souvent une simple étiquette statique ("quota dépassé"), donc ce chemin
n'était jamais exercé avec un `{{ }}` réel jusqu'ici.

Corrigé (`interpolate(node.reason, ctx.expressionContext())` quand `reason` est défini) ; 4
nouveaux tests unitaires (premiers de ce fichier — `stopExecutor.ts` n'en avait aucun avant) dont
le scénario exact rapporté. Vérifié aussi contre la vraie stack : `packages/workflow-core`
reconstruit, conteneur `worker` redémarré (même piège que celui déjà documenté plus haut — un
package partagé modifié pendant qu'un service qui en dépend tourne déjà), puis un workflow réel
`setVariable → stop` exécuté via `curl` confirmant `"reason": "hello world"` (pas le `{{ }}`
littéral) dans le résultat.

## Itération 10 — Node Navigateur : preview live + enregistreur d'actions (Phases B/C, livrée)

Complète l'itération 9 : la moitié "batch" (Phase A) était livrée, restaient la preview live du
navigateur piloté et un bouton "Enregistrer" qui capture automatiquement les interactions réelles
de l'utilisateur comme actions du node — les deux à la demande explicite de l'utilisateur d'origine
("mets en place le prévisualisateur et l'enregistreur d'actions comme c'était prévu à la base").
Ceci **lève formellement** l'entrée "WebSocket temps réel" (§17.12) de la section hors périmètre
ci-dessous, pour ce cas d'usage précis (streaming vidéo + relais d'actions) — pas un transport
WebSocket générique pour le reste de l'UI (exécutions/logs restent en polling, inchangé).

### Phase B — `candidateSelectors` extrait en module partagé, testé une seule fois

Le bouton "Enregistrer" doit calculer un sélecteur pour l'élément avec lequel l'utilisateur
interagit — exactement la même logique que `candidateSelectors(el)` de `htmlSandbox.ts` (jusqu'ici
une chaîne JS dupliquée, injectée dans l'iframe sandboxée de la preview HTML), mais désormais
nécessaire une seconde fois dans une vraie page pilotée par Playwright. Plutôt que dupliquer une
seconde copie qui aurait divergé silencieusement avec le temps, nouveau package
`packages/browser-scripts` : une **unique fonction auto-contenue** (tous les helpers en fonctions
imbriquées, aucune fermeture externe), testée directement (vitest + jsdom), puis réutilisée aux
deux endroits en l'injectant via `` `(${candidateSelectors.toString()})` `` — `htmlSandbox.ts`
remplace son bloc dupliqué par cet appel ; `apps/browser-worker`'s script d'enregistrement (Phase C
ci-dessous) fait de même. Valide tant que la fonction reste sans fermeture externe : vérifié par un
test round-trip dédié (`new Function('return (' + fn.toString() + ')')()`) et en inspectant le
bundle Vite de production réel — la minification renomme la variable englobante mais n'affecte
jamais le code source que `.toString()` capture, puisque `${fn.toString()}` s'évalue à l'exécution.

### Phase C — transport WebSocket, screencast CDP, enregistreur, preview frontend

- **Transport** : aucune infra WebSocket n'existait dans ce monorepo. Nouvelle dépendance
  `@fastify/websocket@^10` (compatible fastify v4 déjà en place — la v11 cible fastify v5) sur
  `apps/browser-worker` **et** `apps/api`, enregistrée via un petit provider (`OnModuleInit`
  injectant `HttpAdapterHost`, `fastify.register(...)` puis `fastify.get(path, {websocket:true},
  handler)`) plutôt qu'un décorateur `@nestjs/websockets` — cohérent avec le reste de `tools`, qui
  utilise déjà des contrôleurs Fastify simples.
- **`apps/browser-worker` — `GET /session/live`** (`session-live.gateway.ts`) : par connexion,
  `assertPublicTarget` sur l'URL de départ (même garde-fou SSRF que la Phase A), navigateur
  **dédié** (même raisonnement d'isolation qu'en Phase A), puis screencast CDP
  (`Page.startScreencast`/`screencastFrame`/`screencastFrameAck` — choisi plutôt qu'un polling
  `page.screenshot()` : push, pas de compromis latence/CPU à deviner) relayé en JPEG base64 ; les
  messages entrants (`mouseMove`/`mouseDown`/`mouseUp`/`wheel`/`keyDown`/`keyUp`) sont rejoués via
  `page.mouse`/`page.keyboard` (API haut niveau Playwright, pas les commandes CDP `Input.dispatch*`
  brutes) ; `startRecording`/`stopRecording` activent/désactivent un script d'enregistrement
  (`recorderScript.ts`, injecté via `page.addInitScript`, ré-armé à chaque navigation puisqu'un
  clic qui charge une page suit un script par défaut désactivé) qui détecte clic/sélection/frappe
  (débouncée jusqu'au `blur`) et calcule un sélecteur via `candidateSelectors` (Phase B) — chaque
  step recomposé est validé côté serveur contre `BrowserActionStepSchema` avant d'être relayé
  (rejeté et journalisé, jamais fatal, en cas d'échec). Une file d'attente promesse-chaînée
  (`enqueue`) garantit un traitement strictement FIFO des messages entrants malgré des appels
  Playwright asynchrones concurrents (rafales de `mousemove`). Nettoyage systématique
  (`context.close()`, jamais juste `page.close()`) sur `close`/`error` du WS, y compris déconnexion
  brutale — jamais de session Playwright orpheline.
- **`apps/api` — relais `GET /tools/session-live`** (`SessionLiveProxyGateway`) : ouvre sa **propre**
  connexion WS cliente vers `browser-worker` par connexion entrante, relaie dans les deux sens, et
  **propage le cycle de vie** (fermer un côté ferme explicitement l'autre — pas juste un relais de
  messages, sinon une session `browser-worker` orpheline persisterait indéfiniment). Garde intact
  l'invariant existant : le frontend ne parle jamais directement à `browser-worker` (qui reste
  `expose`-only dans `docker-compose.yml`, jamais `ports`).
- **Frontend** (`BrowserSessionPreview.tsx`, nouveau) : dessine chaque frame JPEG sur un
  `<canvas>`, capture pointeur/clavier dessus, convertit les coordonnées canvas → viewport distant
  réel (`scaleX = canvas.width / rect.width`, etc., puisque la résolution interne du canvas — celle
  du viewport distant — diffère en général de sa taille affichée). "Enregistrer" bascule
  `startRecording`/`stopRecording` ; chaque action reçue s'accumule dans une liste locale (même
  patron "accumuler puis valider" que `PreviewSelector.tsx`) avant fusion dans `node.steps` via
  `onChange`, une fois "Valider (N actions)" cliqué. Bouton d'ouverture ajouté dans
  `BrowserActionNodeInspector.tsx`.

**Vérifié** : 9 tests unitaires (`packages/browser-scripts`, jsdom) ; 5 tests e2e
(`apps/browser-worker/test/session-live.e2e.test.ts`) contre un **vrai Chrome** via un vrai client
`ws` (streaming de frame, enregistrement d'un clic et d'une frappe débouncée au blur, rejet SSRF,
erreur avant `start`) — `.inject()` (utilisé par toute autre suite e2e de ce dépôt) ne peut pas
faire d'upgrade WebSocket, d'où un nouveau helper `test/support/liveApp.ts` avec un vrai
`app.listen(0)` ; 4 tests e2e (`apps/api/test/session-live.e2e.test.ts`) contre un **faux**
upstream (`WebSocketServer`) — relais dans les deux sens, message mis en file avant l'ouverture de
la connexion amont, fermeture propagée dans les deux sens ; 7 tests de composant
(`BrowserSessionPreview.test.tsx`, WebSocket global mocké) ; un test d'intégration dans
`BrowserActionNodeInspector.test.tsx` (une action validée depuis la preview atterrit bien dans les
steps du node). Vérification bout en bout supplémentaire contre la **vraie stack Docker** : client
`ws` direct sur `ws://localhost:3001/tools/session-live` → chaîne complète api → browser-worker →
vrai Chrome → `https://example.com`, frame JPEG reçue ; même client contre une cible privée
(`http://127.0.0.1:3001`) rejeté par le garde-fou SSRF avec le message d'erreur attendu. 590 tests
Vitest au total dans le monorepo.

### Deux bugs d'environnement Docker trouvés en vérifiant la stack de dev, plus un vrai bug de typage

1. **`nest build`/`nest start --watch` échouaient sur `apps/browser-worker`** (`TS6059`) :
   `tsconfig.build.json` fixe `rootDir: "src"` mais son `exclude` ne listait que `**/*.test.ts` —
   le nouveau `test/support/liveApp.ts` (un vrai fichier `.ts`, pas un test) reste donc inclus par
   le motif par défaut `**/*` tout en étant hors de `rootDir`. `pnpm typecheck` (`tsc --noEmit`,
   sans `-p`) utilise le `tsconfig.json` de base, sans `rootDir`, donc ne voyait jamais cette
   erreur — seul `nest build`/`nest start --watch` (qui utilisent `tsconfig.build.json` par
   convention Nest) la déclenchait. Corrigé en ajoutant `"test"` à l'`exclude` de
   `tsconfig.build.json` — n'affecte pas la couverture de `pnpm typecheck` sur les fichiers de
   test, qui passe par l'autre fichier.
2. **"Connexion perdue avec le service de navigation" en preview**, rapporté par l'utilisateur
   après plusieurs heures avec les conteneurs de dev déjà démarrés. Cause, en deux temps :
   le volume anonyme `node_modules` d'`api` n'avait en réalité jamais reçu de client Prisma généré
   (`node_modules/.prisma/client` absent), et celui de `browser-worker` n'avait pas le lien de
   workspace vers le tout nouveau `@datarover/browser-scripts` (Phase B) — un écart resté invisible
   pendant des heures parce que `nest start --watch` continue de servir son dernier build réussi
   tant qu'aucun changement de fichier ne force une recompilation ; c'est un changement sans
   rapport (nettoyage d'un `dist/` pendant cette vérification) qui a déclenché la recompilation qui
   a fait apparaître les deux (`api` : 62 erreurs `PropertyDoesNotExistOnPrismaService` ; `browser-
   worker` : `@datarover/workflow-types`/`@datarover/browser-scripts` introuvables). Corrigé sans
   reconstruire l'image : `pnpm install --frozen-lockfile` **à l'intérieur** de chaque conteneur déjà
   démarré (régénère le client Prisma et les liens de workspace manquants), puis un simple
   `docker compose restart browser-worker` — nécessaire séparément, parce que `tsc --watch` ne
   réinvalide pas une résolution de module déjà échouée simplement parce qu'un lien symbolique vient
   d'apparaître sur disque après coup. Aucune perte de données (volumes nommés Postgres/Redis,
   jamais concernés par un volume anonyme) : le projet de démonstration créé plus tôt dans la
   session était toujours présent après coup.
3. **Un vrai bug de typage trouvé en rejouant `pnpm turbo run build typecheck lint test` en une
   seule passe combinée** (jamais fait comme telle jusqu'ici pour cette itération, seulement
   package par package) : `BrowserSessionPreview.test.tsx` indexait `removeButtons[0]` sans garde,
   invalide sous `noUncheckedIndexedAccess` (actif dans `tsconfig.base.json`) — invisible via
   `vitest run` seul (les tests passent, esbuild ne type-check pas), seul `tsc --noEmit` le
   détecte. Corrigé par une assertion non-nulle explicite (`removeButtons[0]!`), le même style déjà
   utilisé pour ce cas précis dans `packages/workflow-core/src/retry.test.ts`.

### Un vrai bug produit trouvé — la preview restait bloquée sur "Connexion perdue" malgré une session qui fonctionnait

Signalé par l'utilisateur sur un site réel (`chronocarpe.com/fr`) après que les deux incidents
Docker ci-dessus ont été écartés un par un (conteneurs stables 25 minutes, healthcheck vert, et la
requête WS confirmée en 101 Switching Protocols dans l'onglet Réseau de Firefox lui-même — donc pas
un problème serveur). Cause, une fois le serveur mis hors de cause : `apps/web` charge
`BrowserSessionPreview` sous `React.StrictMode` (`main.tsx`) — en dev, React monte l'effet qui
ouvre le WebSocket, le nettoie, puis le remonte immédiatement une seconde fois. Le **premier**
socket se fait fermer par ce cleanup avant que son handshake ait forcément fini de son point de vue
navigateur, ce qui déclenche un `error`/`close` asynchrone, un peu plus tard, sur cette instance
déjà abandonnée — exactement les deux messages que Firefox affichait dans sa console. Le
gestionnaire `error` de ce composant mettait `errorMessage` à jour sans se demander si le socket
concerné était encore celui de l'effet en cours — et rien ne le réinitialisait ensuite : le
**second** socket (le vrai, celui qui survit) continuait de recevoir ses frames normalement, mais
l'UI restait bloquée à vie sur le message d'erreur du premier, jamais nettoyé.

Corrigé par un drapeau `cancelled` capturé par fermeture à chaque invocation de l'effet (pas une
ref partagée entre invocations) : chacun des quatre gestionnaires d'événements du socket (`open`/
`message`/`close`/`error`) sort immédiatement si son propre effet a déjà été nettoyé — le patron
React standard pour ce cas précis de double-montage. Nouveau test
(`BrowserSessionPreview.test.tsx`) qui rend le composant sous un vrai `<StrictMode>`, confirme bien
deux instances de socket créées, ouvre/alimente la seconde normalement (`ready`, viewport), puis
déclenche un `error` tardif sur la première (déjà abandonnée) — et vérifie que "Connexion perdue"
ne s'affiche jamais. `pnpm turbo run typecheck lint test --filter=@datarover/web` (119/119, +1)
sans régression. Correctif livré uniquement dans `apps/web` (aucun changement serveur) : visible
immédiatement via le rechargement à chaud de Vite, sans redémarrage de conteneur.

### Défilement impossible dans la preview + enregistreur trop partiel — étendu à la demande explicite de l'utilisateur

Signalé par l'utilisateur : "on ne peut pas faire défiler les pages" et "il ne prend pas en compte
tous les événements, frappe clavier, déplacement souris, attente". Deux lacunes réelles,
distinctes, dans ce qui avait été livré ci-dessus :

- **Molette non relayée** : le protocole (`liveMessages.ts`'s `"wheel"`) et le côté serveur
  (`page.mouse.wheel`) existaient déjà, mais `BrowserSessionPreview.tsx` n'attachait jamais
  d'écouteur `wheel` sur le canvas — personne n'envoyait jamais ce message. Corrigé par un
  écouteur natif (`canvas.addEventListener("wheel", ..., { passive: false })`), pas la prop JSX
  `onWheel` : React rend ses écouteurs `wheel`/tactiles passifs par défaut, ce qui rend
  `preventDefault()` silencieusement inopérant — nécessaire ici pour empêcher le défilement
  d'atterrir sur le propre conteneur (`overflow-auto`) de l'aperçu plutôt que sur la page distante.
- **Enregistreur limité à clic/sélection/frappe** (`recorderScript.ts`) : il manquait la frappe de
  touches isolées (Entrée/Tab/Échap/flèches/Origine/Fin/Page haut/Page bas — un `press` en dehors
  de tout champ texte), le défilement de la page (`scrollPage`, débounced sur `scroll` comme
  `type` l'est déjà sur `blur`, plutôt qu'un step par tick), et le survol volontaire
  (`hover`, seulement après un temps de pause au-dessus du seuil `HOVER_DWELL_MS`, jamais sur un
  simple passage). Ajoutés au script, tous les trois testés contre un vrai Chrome.
- **Aucun rythme entre actions rejouées** : chaque step réel de l'utilisateur était déjà séparé
  d'un délai réel (le temps de réflexion, de lecture, …), jamais restitué au rejeu — une séquence
  produite par l'enregistreur donnait donc des actions instantanées les unes après les autres,
  contrairement à `moveMouse`/`type`'s propre délai humain (itération 9). Corrigé côté serveur
  (`SessionLiveGateway.handleRecordedStep`) : un step `wait` est automatiquement inséré devant
  chaque action recomposée dès que l'écart avec la précédente dépasse `AUTO_WAIT_MIN_MS` (400 ms —
  sous ce seuil, c'est juste du bruit de latence, pas une vraie pause), plafonné à
  `AUTO_WAIT_MAX_MS` (15 s — l'utilisateur qui s'est éloigné, pas une pause à rejouer telle
  quelle). Réinitialisé à chaque `startRecording`, pour que la toute première action d'une session
  n'hérite jamais d'un délai mesuré depuis un instant qui n'a rien à voir avec le rythme réel de
  l'utilisateur.

**Un vrai bug trouvé en écrivant les tests de `hover`** : le tout premier jet enregistrait un
`hover` sur `<body>`/`<html>` chaque fois que le curseur restait simplement immobile n'importe où
sur la page au-delà du seuil de pause — y compris juste après n'importe quelle autre action, le
curseur étant *toujours* au repos sur l'un des deux dès qu'il n'est pas sur un élément plus petit.
Corrigé en excluant explicitement `document.body`/`document.documentElement` de la détection de
survol — un test dédié (`"never records a 'hover' for resting on the empty page background"`) le
couvre désormais.

**Un vrai bug trouvé en écrivant le test du rythme automatique** : le `wait` et l'action qu'il
précède arrivent synchrones, dans le même tick — un enchaînement de `waitForMessage` à usage
unique (un par étape attendue, motif déjà utilisé partout ailleurs dans ce fichier de test) rate
le second message : son propre écouteur ne s'enregistre qu'après que le premier `await` se soit
entièrement résolu via la microtask queue, ce qui arrive *après* que le serveur ait déjà émis (et
perdu, faute d'auditeur) le second message. Corrigé en remplaçant, pour ce test précis, la
séquence de `waitForMessage` par un unique auditeur qui accumule tout depuis avant l'envoi de
Tab — plus de fenêtre de non-écoute entre deux messages consécutifs.

**Vérifié** : `recorderScript.ts`/`session-live.gateway.ts` étendus, 10 tests e2e (5 nouveaux) dans
`session-live.e2e.test.ts` contre un **vrai Chrome** (press isolé, scroll débounced, hover réel,
non-hover sur `<body>`, rythme automatique) ; nouveau test de composant pour le relais de la
molette (`BrowserSessionPreview.test.tsx`, 9 tests). Vérifié en direct contre la vraie stack Docker
sur `chronocarpe.com/fr` : navigation, molette relayée sans erreur.

Au passage, un troisième piège Docker distinct des trois déjà documentés dans le README a refait
surface pendant cette vérification (voir README, section Docker) : `typecheck`/`lint`/`test`
déclenchent, via `turbo.json`'s `"dependsOn": ["^build"]`, la **même** reconstruction des `dist/`
de packages partagés que `build` lui-même — pas seulement `build`, comme documenté un peu vite la
première fois que ce piège avait été rencontré plus haut dans cette itération.

### L'enregistreur restait sourd au déplacement de souris et à la plupart des frappes clavier — demandé explicitement par l'utilisateur

Malgré l'extension ci-dessus, l'utilisateur a signalé à nouveau, en termes plus précis : "il manque
les actions de déplacement de la souris et de frappe au touche du clavier". Ceci renverse
délibérément une décision de conception initiale de la Phase C ("jamais une trajectoire de pointeur
brute" — voir le premier jet de `recorderScript.ts`) : l'utilisateur veut le mouvement lui-même
comme action visible et rejouable, pas seulement son effet final (un clic, un survol).

- **`moveMouse`** : `mousemove` débounced (`MOUSE_MOVE_SETTLE_MS`, 250 ms — plus court que le
  survol/défilement : un déplacement doit sembler réactif) jusqu'à la position où le curseur se
  stabilise, plutôt qu'un step par événement natif (des dizaines par seconde pendant un vrai
  glissement de souris). Aucun `delay` n'est fabriqué à l'enregistrement — le mécanisme de `wait`
  automatique (ci-dessus) couvre déjà le rythme réel entre deux actions, y compris entre deux
  `moveMouse`.
- **Frappe clavier élargie** : les touches spéciales déjà couvertes (`PRESS_KEYS`) restent
  détectées où qu'elles surviennent ; **toute** autre touche (raccourcis clavier, widgets pilotés
  au clavier sur un élément non textuel, jeu de touches sur un `<div>`, …) est désormais
  enregistrée en `press` elle aussi, **sauf** à l'intérieur d'un champ éditable (`INPUT`/
  `TEXTAREA`/`contenteditable`), où un caractère imprimable reste capturé uniquement par `type` —
  l'enregistrer une seconde fois en `press` aurait dupliqué la même frappe. Les touches
  modificatrices seules (Shift/Control/Alt/Meta/…) ne sont jamais enregistrées seules — un `press`
  d'un modificateur isolé n'a aucun sens à rejouer.

**Vérifié** : 4 nouveaux tests e2e contre un vrai Chrome (`moveMouse` débounced à la position
finale ; frappe imprimable hors champ texte ; absence de doublon `press` pour une frappe déjà
couverte par `type` ; le test de survol sur `<body>` étendu pour n'exclure que `hover`, plus
seulement "aucune action", puisque `moveMouse` y apparaît désormais légitimement) — 13 tests au
total dans ce fichier, 46/46 pour `apps/browser-worker`. Vérifié en direct contre la vraie stack
Docker (`ws://localhost:3001/tools/session-live`, un vrai `startRecording` suivi d'un déplacement
de souris puis d'une frappe "a") : les deux actions attendues, `moveMouse` puis `press`, reçues
sans erreur.

### Le focus clavier restait sur le node de l'éditeur, pas sur l'aperçu — la frappe n'atteignait jamais la session distante

Signalé par l'utilisateur en deux temps : "il ne detect pas l'action de frappe du clavier" dans un
champ de saisie, puis, plus alarmant, "quand j'appuie sur backspace il ne supprime pas le caractère
tapé mais supprime le node". Pas un bug de l'enregistreur (côté `browser-worker`, déjà couvert par
les tests ci-dessus) mais du **canvas de l'aperçu lui-même** (`BrowserSessionPreview.tsx`) : Firefox
(contrairement à Chrome/Safari) ne donne pas automatiquement le focus clavier à un élément cliqué
qui n'est pas un vrai champ de formulaire, même avec `tabIndex={0}`. Le focus restait donc sur le
node de l'éditeur derrière la fenêtre — chaque frappe, Backspace compris, partait vers React Flow
plutôt que vers le `onKeyDown` du canvas, déclenchant son raccourci intégré "Backspace supprime le
node sélectionné" au lieu d'atteindre la session distante.

Corrigé par deux mesures, l'une positive, l'autre défensive : `event.currentTarget.focus()`
explicite dans `handleMouseDown` (ne pas compter sur le comportement par défaut du navigateur,
inconsistant selon le navigateur) ; `event.stopPropagation()` en plus de `preventDefault()` dans
`handleKeyDown`/`handleKeyUp` (`preventDefault()` seul n'empêche pas l'événement de continuer à se
propager vers un raccourci global situé plus haut dans l'arbre DOM — seul `stopPropagation()` le
fait). Deux nouveaux tests le couvrent : le focus bascule bien sur le canvas au clic, et un
"Backspace" envoyé au canvas n'atteint jamais un écouteur `keydown` natif posé sur un ancêtre —
reproduisant littéralement le raccourci de React Flow. 122/122 tests pour `apps/web`.

### `press` ne se déclenchait toujours pas dans un champ de saisie — le compromis "déjà couvert par `type`" abandonné

Une fois le focus corrigé ci-dessus, l'utilisateur a signalé une dernière fois : "il ne detecte
toujours pas l'action press quand on est dans un champs input text". Le premier jet de `press`
excluait délibérément les caractères imprimables **à l'intérieur** d'un champ éditable, au motif
qu'ils étaient déjà couverts par `type` (voir plus haut) — un compromis qui, du point de vue de
l'utilisateur, se lisait simplement comme "press ne marche pas dans les champs". Abandonné :
`press` s'enregistre désormais pour **toute** touche, partout, y compris dans un champ de texte —
en plus, pas à la place, du `type` agrégé au blur du champ. Seules les touches modificatrices
seules (Shift/Control/Alt/Meta/…) restent jamais enregistrées seules. Le test qui vérifiait
l'ancien comportement ("never records a standalone 'press' ... already covered by 'type'") est
retourné en son contraire exact. 13/13 tests dans `session-live.e2e.test.ts`, vérifié en direct
contre la vraie stack (une frappe "h" dans une session enregistrée → `{"type":"press","key":"h"}`
reçu).

### Un vrai bug produit trouvé — un sélecteur non unique pouvait faire échouer le rejeu sur un vrai site (violation de mode strict Playwright)

Signalé par l'utilisateur en conditions réelles (`chronocarpe.com`) :
`browserAction "New Navigateur" failed: Step 7 (hover) failed: locator.hover: ... strict mode
violation: locator('.full-width') resolved to 937 elements`. Cause : `pickSelector()`
(`recorderScript.ts`) prenait toujours le **premier** candidat renvoyé par `candidateSelectors()`
(`packages/browser-scripts`) sans jamais vérifier qu'il désigne un seul élément sur la page réelle
— cette fonction, par conception documentée dans son propre commentaire, ne fait que produire une
liste **ordonnée** de candidats plausibles (id → attributs `data-*` → classes "propres" → classe
brute complète → combo classe-parent+classe-propre → chemin ancré positionnel), sans jamais elle-
même les valider ; c'est censé être la responsabilité d'une autre couche. Sur un site utilisant une
classe utilitaire CSS commune (type Bootstrap), cette classe finit souvent dans les "classes
propres" d'un élément et devient son tout premier candidat — alors qu'elle est partagée par des
centaines d'autres éléments de la page. L'enregistreur l'enregistrait telle quelle ; au rejeu,
Playwright refuse, à raison, d'agir sur un locator ambigu.

Investigation complémentaire (agent d'exploration dédié) avant correctif, pour ne rien casser
d'existant :
- `apps/web/src/lib/htmlSandbox.ts`'s picker (outil de sélection visuelle du node `extract`) n'a
  **pas** le même bug : il envoie la liste complète de candidats à l'application, qui les fait
  scorer/valider par le vrai backend (`packages/extractor`'s `extractWithCss`, contre du HTML réel
  via `cheerio`) et laisse un humain choisir — jamais de commit automatique sur un candidat non
  vérifié. Rien à corriger de ce côté.
- `packages/extractor`'s `scoreSelector` est purement syntaxique (une chaîne en entrée, aucun
  accès au DOM) — ni réutilisable tel quel pour une vérification d'unicité, ni portable dans un
  script injecté en navigateur (le vrai matching vit dans `extractWithCss`, qui dépend de
  `cheerio`, une lib Node).
- `pickSelector` est le seul endroit de tout le dépôt qui commet un candidat non validé, sans
  supervision humaine ni passage par un scoring backend.
- Le fixture existant de `session-live.e2e.test.ts` n'avait aucun élément à classe partagée — un
  correctif d'unicité ne pouvait donc rien casser, mais ne bénéficiait non plus d'aucun filet de
  sécurité contre cette régression précise.

Corrigé en réécrivant `pickSelector` pour parcourir les candidats dans l'ordre et retenir le
premier qui résout, via `document.querySelectorAll(...)`, à exactement l'élément visé (et aucun
autre) — avec repli sur le dernier candidat (le chemin ancré, le plus spécifique produit par
`candidateSelectors`) si aucun n'est unique, plutôt que de ne rien enregistrer.

**Vérifié** : nouveau fixture dans `session-live.e2e.test.ts` avec deux éléments partageant la
même classe `.full-width` sans aucun id (reproduisant fidèlement le cas réel) — un nouveau test
confirme que le sélecteur enregistré est `.unique-wrapper .full-width` (un candidat plus loin dans
la liste, réellement unique) et jamais `.full-width` seul. 14/14 tests dans ce fichier (+1), 50/50
pour `apps/browser-worker`. `pnpm turbo run typecheck lint test` sur l'ensemble du monorepo :
46/46 tâches, 655 tests au total. Conteneur `browser-worker` reconstruit/redémarré pour prendre en
compte le correctif en environnement Docker live.

## Itération 11 — Mise en page persistée (position des nodes), à la demande explicite de l'utilisateur

Jusqu'ici (itération 3), la position de chaque node à l'écran était **entièrement éphémère** :
recalculée par un BFS déterministe (`autoLayout`, `workflowGraph.ts`) à **chaque** chargement d'un
workflow, jamais lue depuis ni écrite vers la définition persistée — glisser un node réorganisait
bien l'affichage local et marquait l'éditeur "modifié", mais `flowToDefinition` ignorait
explicitement la position au moment d'enregistrer. Rouvrir un workflow perdait donc toujours toute
réorganisation manuelle. Signalé par l'utilisateur : "il faudrait maintenant enregistrer la
disposition des nodes dans le workflow".

- **Schéma** (`packages/workflow-types/src/action.ts`) : nouveau `NodePositionSchema` (`{x, y}`,
  deux `number`), ajouté en `position?: NodePositionSchema` sur `BaseNodeSchema` — donc hérité par
  tous les types de node, `BrowserActionNodeSchema` compris malgré son `.strict()` : ce dernier ne
  rejette que les clés absentes de la forme résultante, et `position` en fait partie via la chaîne
  `.omit({retryPolicy:true}).extend({...})` qui part bien de `BaseNodeSchema`. Optionnel (jamais
  `.default()`) : une définition enregistrée avant cette itération continue de parser sans aucune
  migration — `definition` est une simple colonne `Json` côté Prisma, aucun changement de schéma
  de base de données n'a été nécessaire non plus.
- **`apps/web/src/lib/workflowGraph.ts`** : `definitionToFlow` préfère désormais `node.position`
  quand il existe, et n'invoque `autoLayout` que comme filet de sécurité pour les nodes qui n'en
  ont pas encore (nouveau node, ou workflow enregistré avant cette itération). `flowToDefinition`
  écrit la position React Flow *actuelle* de chaque node sur le node du domaine au moment de
  l'enregistrer — c'est le seul endroit où une réorganisation manuelle devient réellement
  persistée. Aucun autre changement nécessaire dans `WorkflowEditorPage.tsx` : `onNodesChange`
  alimentait déjà l'état local `nodes` à chaque glissement (et marquait l'éditeur "modifié"), et
  `handleSave` appelait déjà `flowToDefinition` avec cet état — seul le fait que cette fonction
  ignorait la position jusqu'ici bloquait la persistance.
- **Aucun changement** côté `apps/api` (DTOs/contrôleur/service dérivent tous directement de
  `WorkflowDefinitionSchema`, donc valident/acceptent le nouveau champ sans modification) ni côté
  `packages/database` (colonne `Json`, pas de migration).

**Vérifié** : nouveaux tests unitaires (`workflowGraph.test.ts`, 3 ajoutés, 28 au total) — une
position déjà enregistrée est préservée telle quelle (pas recalculée par `autoLayout`) ; un
déplacement simulé sur le canvas est bien capturé à l'enregistrement ; le round-trip
`definitionToFlow`/`flowToDefinition` reste structurellement identique par ailleurs. Vérifié en
direct contre la vraie stack Docker : un workflow créé via l'API réelle avec
`"position": {"x":123,"y":456}` sur un node, relu ensuite via `GET /workflows/:id` — position
identique, aucune perte. `pnpm turbo run typecheck lint test` (46/46 tâches) sans régression sur
l'ensemble du monorepo, y compris les suites e2e navigateur réel (`browser-worker`, `api`).

## Itération 12 — Pool de proxies global, réutilisable par les nodes `http` et `browserAction`

À la demande explicite de l'utilisateur : faire tourner les workflows (scraping notamment) à
travers un pool de proxies mutualisé plutôt que de configurer une IP fixe par node. Décision
validée avec l'utilisateur avant implémentation : la "purge" d'un proxy ayant atteint son seuil
d'erreurs est une **suppression physique** de la ligne (pas un passage en statut désactivé) —
aucun historique conservé. C'est aussi la première ressource **globale** (jamais rattachée à un
`Project`) et le premier **endpoint paginé** de toute l'API — deux précédents établis ici, pas
copiés d'un existant.

**Fait d'architecture déterminant** : `apps/worker` dépend directement de `@datarover/database`
(Prisma) — c'est lui, pas `apps/api`, qui persiste les `Execution`. `packages/workflow-core`, à
l'inverse, n'a **aucune** dépendance à Prisma (architecture volontairement pure/testable sans DB).
La logique de réservation/libération/purge vit donc dans `packages/database/src/proxyPool.ts` (sur
un vrai `PrismaClient`), et `packages/workflow-core` ne reçoit qu'une **petite interface injectée**
(`ProxyPoolClient`, nouveau champ optionnel sur `NodeExecutionContext`/`RunOptions`) — exactement
le même principe que `runNode` (déjà un champ optionnel ajouté pour un seul exécuteur,
`loopExecutor`). `apps/worker`'s `processExecutionJob.ts` construit l'implémentation concrète et
l'injecte dans `engine.run()`. Aucun appel HTTP `packages/workflow-core` → `apps/api` n'existe.

- **Schéma** (`packages/database/prisma/schema.prisma`) : `enum ProxyStatus { active disabled }`,
  `model Proxy` (`host`, `port`, `status`, `errorCount`, `isInUse`, `reservedAt`, timestamps,
  `@@unique([host, port])`), `model ProxyPoolConfig` (une seule ligne, id fixe `"singleton"`, même
  convention que les ids de seed déjà fixes dans ce dépôt — pas de table de settings générique).
- **`packages/database/src/proxyPool.ts`** (nouveau) :
  - `reserveAvailableProxy` — **une seule requête SQL brute** (`$queryRaw`),
    `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ...`. Le point le
    plus critique de correction de toute la fonctionnalité : sans `FOR UPDATE SKIP LOCKED`, deux
    exécutions concurrentes (`apps/worker` tourne avec `concurrency: 5`, scalable en plusieurs
    répliques via `--scale worker=3`) pourraient réserver le même proxy "disponible" en même
    temps — un simple `findFirst` + `update` séparés ne l'empêcherait pas. Une réservation
    orpheline (worker mort en pleine exécution) se libère toute seule après 15 minutes
    (`reservedAt` trop ancien), sans job de nettoyage séparé.
  - `releaseProxy` — tolère que la ligne ait déjà été purgée (P2025) : rien à libérer, pas un bug.
  - `reportProxyErrorAndMaybePurge` — incrémente puis, dans la même transaction, supprime la ligne
    si le seuil (`ProxyPoolConfig.purgeErrorThreshold`) est atteint.
  - **Vérifié** : tests d'intégration contre un vrai Postgres (même convention que le reste de ce
    dépôt) — N appels `reserveAvailableProxy` concurrents sur un seul proxy n'en réservent qu'un
    seul (preuve réelle du `SKIP LOCKED`) ; réservation périmée reclaimée ; purge exactement au
    seuil, jamais avant. 9 tests.
- **`apps/api/src/proxies/`** (nouveau module, calqué sur `projects/` pour le CRUD et sur
  `tools`/`health` pour être un contrôleur global) : `GET /proxies?page=&limit=&status=` →
  `{items, total, page, limit}`, `POST`/`PATCH`/`DELETE /proxies/:id` (rejette un doublon
  host+port avec un 409 clair), `GET`/`PATCH /proxies/config`. **Vérifié** : 7 tests e2e contre un
  vrai Postgres (CRUD complet, pagination sans doublon/trou entre pages, filtre par statut,
  doublon rejeté, config avec sa valeur par défaut).
- **`packages/workflow-types`** : `networkMode: z.enum(["direct","proxy"]).default("direct")`
  ajouté à `HttpNodeSchema` et individuellement dans le `.extend()` de `BrowserActionNodeSchema`
  (son `.strict()` exige que le champ y soit listé explicitement).
- **`packages/workflow-core`** : `httpExecutor.ts` réserve via `ctx.proxyPool`, construit un
  `undici.ProxyAgent` (déjà disponible, `undici@^6`, aucune dépendance nouvelle), le passe en
  `dispatcher` ; `release` systématique en `finally`, `reportError` uniquement si `request()` a
  levé (une réponse HTTP 4xx/5xx normale n'est jamais un throw côté undici — jamais faussement
  imputée au proxy). `browserActionExecutor.ts` fait de même puis transmet `{host, port}` dans le
  payload déjà envoyé à `POST /session/run` — ici, contrairement à `httpExecutor`, aucun moyen
  fiable de distinguer "le proxy est mauvais" de "la cible est mauvaise" (browser-worker renvoie
  la même réponse générique dans les deux cas) : un échec compte toujours contre le proxy, une
  simplification délibérée et documentée plutôt qu'une fausse précision. Une requête qui
  n'atteint jamais browser-worker (service injoignable) ne compte jamais contre le proxy, elle.
  **Vérifié** : `httpExecutor.test.ts` (nouveau, 6 tests) contre un **vrai mini-proxy** local
  gérant `CONNECT` (undici tunnelise toujours, HTTP ou HTTPS) ; `browserActionExecutor.test.ts`
  (+5 tests, proxy factice).
- **`apps/browser-worker`** : `session/dto.ts` accepte un `proxy?: {host, port}` optionnel,
  `session.controller.ts` le relaie, `session.service.ts`'s `launchDedicatedBrowser` passe
  `proxy: {server: "http://host:port"}` à `chromium.launch()`. **Vérifié en écrivant le test** :
  Chromium tunnelise (`CONNECT`) son propre trafic de fond (Safe Browsing, compte Google, …) à
  travers le proxy configuré, mais **jamais** un `startUrl` en `http://` — un vrai navigateur
  forward un tel target par une requête normale en URI absolue, sans `CONNECT` du tout
  (contrairement à `undici`, qui tunnelise systématiquement) ; le mini-proxy de test doit gérer
  les deux styles. +3 tests réels contre un vrai Chrome.
- **`apps/worker/src/processExecutionJob.ts`** : `buildProxyPoolClient(prisma)` construit
  l'implémentation concrète, injectée dans `engine.run({..., proxyPool})`. **Vérifié** : 2 tests
  d'intégration bout en bout contre un vrai Postgres + un vrai mini-proxy — un vrai `Proxy` réservé
  via une vraie exécution puis relâché (`isInUse` repasse à `false`) ; un vrai `Proxy` purgé
  (ligne supprimée) après un échec de connexion réel à travers le proxy.
- **Frontend** : `HttpNodeInspector.tsx`/`BrowserActionNodeInspector.tsx` gagnent un `<select>`
  "Mode réseau" (Adresse actuelle / Proxy disponible). Nouvelles pages globales
  `ProxiesPage.tsx` (route `/proxies`, lien "Proxies" dans l'en-tête) — liste paginée/filtrable par
  statut, création/activation-désactivation/suppression inline — et `ProxyConfigPage.tsx` (route
  `/proxies/config`, distincte de la liste selon la demande explicite de l'utilisateur) pour le seuil
  de purge. `api/proxies.ts` (nouveau, calqué sur `projects.ts`). **Vérifié** : 3 tests
  (`HttpNodeInspector.test.tsx`, nouveau fichier — ce composant n'avait aucun test avant), 7 tests
  (`ProxiesPage.test.tsx`), 2 tests (`ProxyConfigPage.test.tsx`), `fetch` mocké comme le reste
  d'`apps/web` — premiers tests de page à monter un composant complet avec
  `QueryClientProvider`/routeur, aucune page de ce genre n'était testée avant.

**Un vrai bug trouvé en ajoutant le nouveau champ `<select>`** : l'ajouter *avant* la section des
steps dans `BrowserActionNodeInspector.tsx` a décalé de un tous les index positionnels
(`getAllByRole("combobox")[N]`) que 15 tests existants utilisaient déjà pour cibler le sélecteur de
type d'étape — cassant leur ordre supposé (`steps` réordonnés/mal configurés dans les assertions).
Corrigé en décalant chaque index d'un cran ; aucun changement de comportement du composant
lui-même, seulement de la façon dont les tests déjà en place localisaient les éléments.

**Vérifié globalement** : `pnpm turbo run typecheck lint test` sur l'ensemble du monorepo — 46/46
tâches, 654 tests au total (aucune régression). Vérification manuelle en direct contre la vraie
stack Docker : cycle complet create/get/patch(statut)/filtre/delete sur `POST/GET/PATCH/DELETE
/proxies` et `GET/PATCH /proxies/config`, toutes les routes correctement mappées au démarrage des
conteneurs `api`/`browser-worker`/`worker` fraîchement reconstruits.

## Itération 13 — Réordonner/réenregistrer une étape `browserAction` en place, à la demande explicite de l'utilisateur

Signalé par l'utilisateur en conditions réelles, immédiatement après le correctif de l'itération
10 pour le sélecteur non-unique : le correctif portait uniquement sur **l'enregistreur** (nouvelles
captures), pas sur les workflows **déjà enregistrés** — le node "New Navigateur" de l'utilisateur
contenait toujours, en base, une étape `hover` avec le vieux sélecteur `.full-width` non-unique.
Avant de corriger cette étape précise, une hypothèse fausse a été proposée ("ce survol semble
accidentel, sans clic derrière") — l'utilisateur a eu raison de la rejeter aussitôt : "on peu très
bien survoler un element ssans pour autant cliqué dessus". Une tentative de rejouer les coordonnées
d'origine sur le vrai site pour déduire automatiquement un remplacement a aussi été abandonnée : le
contenu du site (bannière cookies géo-dépendante, carrousel promotionnel dont les images changent
quasi quotidiennement) n'est pas stable dans le temps, donc une position en pixels rejouée plus
tard ne retombe pas fiablement sur le même élément — exactement la raison pour laquelle le
sélecteur d'origine s'était déjà dégradé entre deux essais (937 puis 954 éléments correspondants).

Faute de pouvoir deviner l'intention de l'utilisateur à sa place, deux manques réels de l'éditeur
ont été comblés, pour que corriger une seule étape déjà enregistrée soit un geste direct plutôt
qu'un contournement manuel :

- **Réordonner une étape** (`BrowserActionNodeInspector.tsx`) : boutons "▲"/"▼" sur chaque étape
  (`stepsArray.move`, déjà fourni par `useFieldArray` de `react-hook-form` — aucune nouvelle
  dépendance), désactivés en haut/bas de liste plutôt que masqués, pour que la rangée de boutons ne
  saute jamais visuellement d'une étape à l'autre.
- **Réenregistrer une seule étape, en place** : un bouton "🔄 réenregistrer" apparaît sur toute
  étape d'un type que l'enregistreur sait produire (`RECORDABLE_STEP_TYPES` — les 7 mêmes types que
  `recorderScript.ts` émet : click/hover/select/type/press/moveMouse/scrollPage — jamais `wait`,
  calculé automatiquement, ni les types purement manuels comme `dragTo`), et seulement une fois une
  `startUrl` renseignée. Il ouvre `BrowserSessionPreview` en "mode remplacement" : un bandeau
  ambre nomme l'étape ciblée (type + sélecteur/touche), le bouton "Valider" devient "Remplacer".
  `BrowserSessionPreview` elle-même reste neutre sur ce choix (nouveau prop `replaceLabel`, purement
  cosmétique — bandeau + libellé du bouton) ; c'est `BrowserActionNodeInspector`'s
  `handleValidateRecording` qui, si un `replacingIndex` est actif, fait `stepsArray.remove(index)` +
  `stepsArray.insert(index, ...)` au lieu d'un simple `append` — la preview enregistre toujours en
  ajoutant en interne, donc sans cette redirection l'étape corrigée aurait atterri en fin de liste,
  à charge pour l'utilisateur de la remonter à la main. Fermer la preview sans valider réinitialise
  le mode remplacement (`handleClosePreview`), pour qu'un enregistrement général ultérieur ajoute
  bien à la fin plutôt que d'écraser silencieusement la dernière étape ciblée.

**Vérifié** : 7 nouveaux tests — `BrowserSessionPreview.test.tsx` (+2 : bandeau + libellé
"Remplacer" affichés quand `replaceLabel` est fourni, "Valider" sans bandeau sinon) et
`BrowserActionNodeInspector.test.tsx` (+5 : réordonnancement effectif, flèches désactivées aux
extrémités, bouton "réenregistrer" absent sans `startUrl`/pour un type non enregistrable, un
remplacement en place préserve bien l'ordre des étapes voisines — le scénario exact du bug
rapporté —, fermeture sans validation qui n'empêche pas un enregistrement général ultérieur
d'ajouter normalement). `pnpm turbo run typecheck lint test` sur l'ensemble du monorepo : 46/46
tâches, 662 tests au total (aucune régression). Correctif livré uniquement dans `apps/web` (aucun
changement serveur) : visible immédiatement via le rechargement à chaud de Vite, sans redémarrage
de conteneur.

### `candidateSelectors` élargi à `href`/`src`/`name`/`alt`/`title`/`aria-label`/`placeholder` — à la demande explicite de l'utilisateur

Le correctif de sélecteur unique (plus haut) ne portait que sur **les nouvelles captures** — le
workflow déjà enregistré de l'utilisateur en contenait d'autres, issus du même vieil enregistrement
pré-correctif. Après avoir corrigé l'étape 7 (`.full-width`), l'exécution a échoué à l'étape 8 sur
un second sélecteur non-unique, `.nav-link.clickable2` (35 liens de menu partageant la même classe)
— un motif qui se répétait 3 fois dans ce seul workflow. Plutôt que de rejouer les coordonnées
d'origine sur le vrai site pour deviner un remplacement (déjà tenté et abandonné pour le premier
sélecteur — le contenu du site n'est pas stable dans le temps), l'utilisateur a directement pointé
la cause structurelle : `candidateSelectors` (`packages/browser-scripts`) ne considérait jusque-là
que `id`/`data-*`/classes — jamais les autres attributs (`href`, `src`, …) qui identifient pourtant
un élément de façon bien plus fiable qu'une classe partagée par toute une catégorie d'éléments
similaires (un lien de menu, une image de carrousel).

Deux nouveaux groupes de candidats, insérés dans l'ordre existant (jamais en remplacement) :
- **`IDENTITY_ATTRIBUTES`** (`href`, `src`) : insérés juste après `data-*`, avant tout candidat à
  base de classe — un lien ou une image a normalement une cible propre à lui, un bien meilleur
  signal d'unicité qu'une classe partagée par toute une catégorie de liens/images similaires.
- **`DESCRIPTIVE_ATTRIBUTES`** (`name`, `alt`, `title`, `aria-label`, `placeholder`) : insérés après
  les classes (propres puis brutes), pas avant — ces attributs sont utiles mais plus susceptibles
  de se répéter eux aussi (plusieurs boutons partageant le même `title`, un `placeholder` générique
  répété sur plusieurs champs).

**Explicitement exclu, alors même que l'utilisateur l'avait cité en exemple** : `style`. Il encode
l'apparence/la position, pas l'identité — deux éléments sans aucun rapport partageant la même mise
en page (`position:fixed;top:10px;left:10px`) est banal, et le `style` d'un élément est
fréquemment réécrit par le JS de la page après son chargement, contrairement à `href`/`src`/`id`/
`class`. Justifié explicitement à l'utilisateur plutôt qu'implémenté sans le dire.

Chaque candidat est tag-scopé (`a[href="…"]`, pas `[href="…"]` seul) pour la lisibilité du
sélecteur enregistré, et rejeté (comme déjà `data-*`) si sa valeur contient un `"` littéral
(casserait le guillemetage du sélecteur) — avec, en plus, une limite de longueur (300 caractères)
absente du traitement `data-*` existant : un `src`/`href` en URI `data:` inline peut peser plusieurs
méga-octets, un candidat techniquement valide mais absurde à enregistrer. Le correctif de la
dernière itération (validation d'unicité contre le DOM réel avant de choisir) reste inchangé et
continue de piloter *lequel* de ces candidats élargis est effectivement retenu — cet ajout ne fait
qu'enrichir la liste que ce mécanisme parcourt.

**Vérifié** : 6 nouveaux tests unitaires (`candidateSelectors.test.ts`, 9 → 15) — `href`/`src`
proposés et prioritaires sur les classes, attributs descriptifs proposés après les classes,
`style` jamais considéré, valeur contenant un `"` rejetée, valeur `data:` trop longue rejetée.
+1 test e2e contre un vrai Chrome (`session-live.e2e.test.ts`) reproduisant le scénario réel :
deux liens partageant `.nav-link.clickable2`, sélecteur enregistré confirmé être
`a[href="/cannes-c7/"]`, jamais la classe partagée. `pnpm turbo run typecheck lint test` :
46/46 tâches, 669 tests au total. **Piège rencontré pendant la vérification** : le nouveau test e2e
échouait une première fois avec l'ancien comportement encore actif — `packages/browser-scripts`
publie sa logique via un `dist/` compilé (`tsup`), jamais lu directement depuis `src/` par ses
consommateurs (`apps/browser-worker`, `apps/web`) ; modifier `candidateSelectors.ts` sans relancer
`pnpm --filter @datarover/browser-scripts build` laisse tourner l'ancienne version compilée — un
piège de plus dans la même famille que les autres problèmes de `dist/` périmé déjà documentés dans
ce fichier, mais côté package partagé cette fois, pas côté conteneur Docker. Conteneurs
`browser-worker`/`web` redémarrés pour prendre en compte le `dist/` reconstruit.

#### Extension immédiate — combiner classe et attribut, à la demande explicite de l'utilisateur

L'élargissement ci-dessus n'a pas suffi : l'exécution suivante a échoué sur un troisième sélecteur
non-unique, `img.full-width` (210 correspondances, des images de carrousel promotionnel). L'analyse
de l'erreur a révélé que plusieurs de ces images apparaissent **deux fois dans le DOM avec des
attributs strictement identiques** (même `src`, même `alt`) — le carrousel (slick.js) clone ses
diapositives pour un effet de défilement infini sans coupure, une pratique standard de cette classe
de bibliothèques. L'utilisateur a réagi vivement ("tu peux les cumuler bordel !!!! class+ href ou
href + id […] cumuler toutes les information d'un item pour pouvoir le retrouver") — une demande
légitime distincte du bug ponctuel : jusqu'ici, chaque candidat reposait sur **un seul** signal
(une classe seule, un attribut seul) ; aucun candidat ne combinait plusieurs signaux pour départager
deux éléments dont ni la classe ni l'attribut, pris isolément, ne sont uniques sur toute la page,
mais dont la **combinaison précise** l'est.

Nouveau candidat, `candidateSelectors` (`packages/browser-scripts`) : pour chaque élément ayant au
moins une classe "propre", un nouveau candidat est généré pour **chacun** des attributs
`IDENTITY_ATTRIBUTES`/`DESCRIPTIVE_ATTRIBUTES` présents, sous la forme `.classe[attribut="valeur"]`
— inséré juste avant le candidat "classe seule", puisque strictement plus spécifique : s'il résout,
c'est un meilleur choix. Exemple concret ajouté aux tests : deux `<span class="badge">` avec des
`title` différents ("En stock"/"Rupture") plus un `<span class="tag" title="En stock">` sans
rapport — ni `.badge` (2 correspondances) ni `[title="En stock"]` (2 correspondances, sur un tag
différent) n'est unique seul, mais `.badge[title="En stock"]` l'est.

**Limite honnête, expliquée explicitement à l'utilisateur plutôt que passée sous silence** : cette
extension ne pouvait *pas*, par construction, corriger l'échec qui l'a motivée. Un clone de
diapositive produit deux **vrais** nœuds DOM dont absolument tous les attributs — classe, `src`,
`alt`, jusqu'au moindre `data-*` — sont identiques mot pour mot ; aucune combinaison d'attributs,
aussi exhaustive soit-elle, ne peut distinguer deux éléments réellement indiscernables au niveau des
attributs. Distinguer un clone de l'original demande une information **positionnelle** (le Nième
élément correspondant), un problème différent et plus difficile, volontairement non traité ici — et
documenté comme tel dans le commentaire de tête de `candidateSelectors.ts`. Par ailleurs, cette
étape précise (survoler une image du carrousel promotionnel) vise un contenu qui change
quotidiennement sur le vrai site (dates dans les URLs des images) : même un sélecteur robuste
aujourd'hui ne survivrait probablement pas à la rotation du lendemain — signalé à l'utilisateur
comme une limite de conception de cette étape précise, pas seulement du sélecteur.

**Vérifié** : 3 nouveaux tests unitaires (`candidateSelectors.test.ts`, 15 → 18) — candidat combiné
présent et prioritaire sur la classe seule pour un attribut descriptif, combinaison avec
`href`/`src` également, aucun candidat combiné construit à partir d'un attribut déjà rejeté
(guillemet/longueur). +1 test e2e contre un vrai Chrome reproduisant exactement le scénario "ni la
classe ni l'attribut seul n'est unique, la paire l'est" et confirmant le sélecteur combiné retenu.
`pnpm turbo run typecheck lint test` : 46/46 tâches, 673 tests au total. Conteneurs
`browser-worker`/`web` redémarrés après reconstruction du `dist/` de `packages/browser-scripts`.

#### La "limite honnête" ci-dessus, résolue quand même — exclusion par différence d'ancêtre, à la demande explicite de l'utilisateur

L'utilisateur a refusé la limite énoncée ci-dessus point par point : "le but est de décrire un
fonctionnement humain [...] si je dois survoler je survole basta [...] tu peux cumuler les attributs
[...] c'est certes plus lourd, mais plus précis". Deux choses distinctes dans cette insistance,
prises au sérieux séparément : (1) refuser qu'on lui suggère de supprimer/contourner une étape sous
prétexte qu'elle est difficile à sélectionner — un survol enregistré reflète un geste humain réel,
pas une fioriture à retirer pour simplifier le problème ; (2) une intuition techniquement correcte,
vérifiée avant d'implémenter quoi que ce soit : si le clone et l'original sont identiques dans
*leurs propres* attributs, rien ne les distingue à ce niveau — mais un **ancêtre** peut très bien
différer. Vérification en conditions réelles (requête `POST /render`, en lecture seule, sans aucune
interaction avec la page — contrairement à la tentative de rejeu de coordonnées de l'itération
précédente, qui avait accidentellement cliqué un élément du site réel) : le carrousel de
`chronocarpe.com` utilise bien slick.js, et chaque diapositive clonée est enveloppée dans un
`<div class="slick-slide slick-cloned" aria-hidden="true">`, tandis que la diapositive réelle
correspondante est dans un `<div class="slick-slide">` (sans `slick-cloned`) — la classe
distinctive existe, juste pas sur l'élément survolé lui-même.

Nouvelle fonction `refineByExcludingAncestorClass` (`apps/browser-worker/src/session/
recorderScript.ts`, pas `packages/browser-scripts` — voir plus bas pourquoi) : quand un candidat de
`candidateSelectors` résout à un petit nombre d'éléments (≤ `ANCESTOR_REFINEMENT_MAX_MATCHES`, 20 —
jamais tenté sur un candidat déjà large comme `.full-width` seul avec 200+ correspondances, où
aucune exclusion d'ancêtre ne produira jamais un sélecteur sain), compare la chaîne d'ancêtres de
l'élément visé, niveau par niveau, à celle de chacun des *autres* éléments correspondants ; au
premier niveau où l'ancêtre d'un autre élément porte une classe que l'ancêtre — au même niveau — de
l'élément visé n'a pas, construit `tag.classesPropresDeLElement:not(.classeEnTrop) candidat` et le
teste contre le DOM réel. Pour le cas concret : sur le candidat `img[src="..."]` (3 correspondances,
un original + deux clones), le premier niveau où les ancêtres divergent produit
`div.slick-slide:not(.slick-cloned) img[src="..."]` — unique, correct.

**Pourquoi dans `recorderScript.ts` et pas `candidateSelectors.ts`** : cette comparaison a
fondamentalement besoin de voir *tous* les éléments correspondants pour en tirer une différence —
`candidateSelectors` est, par conception (voir son propre commentaire), une fonction PAR ÉLÉMENT,
aveugle aux autres candidats sur la page ; c'est `pickSelector`, qui a déjà le DOM réel sous la main
au moment de l'enregistrement, qui est le bon endroit pour ce genre de comparaison.

**Limite qui subsiste, honnêtement inchangée** : cette technique fonctionne parce que
`slick-cloned` marque une différence *structurelle* réelle entre l'original et son clone. Si un jour
un clone et son original étaient identiques absolument partout, y compris sur tous leurs ancêtres
jusqu'à `<body>`, aucune différence n'existerait à exploiter — mais ce n'est pas le cas ici, et ne
l'est en général pas pour ce type de bibliothèque de carrousel.

**Vérifié** : nouveau fixture (`session-live.e2e.test.ts`) reproduisant fidèlement le motif réel —
trois `<img>` strictement identiques entre eux, deux enveloppées dans un `div.slick-slide.slick-
cloned`, une dans un simple `div.slick-slide` — confirme que le sélecteur enregistré pour l'élément
réel est bien `div.slick-slide:not(.slick-cloned) img[src="..."]`. **Piège rencontré en écrivant ce
test** : la classe `full-width`, réutilisée à dessein dans le fixture du tout premier bug (pour
rester fidèle au cas réel), entrait en collision avec ce nouveau fixture partageant la même page —
la nouvelle logique d'exclusion d'ancêtre trouvait alors, par coïncidence, une classe (`slick-slide`)
d'un fixture sans rapport et produisait un sélecteur différent (toujours correct, mais pas celui
attendu par le test). Corrigé en renommant la classe du nouveau fixture (`promo-slide-img`) —
un rappel que plusieurs fixtures accumulés sur une seule page partagée peuvent se contaminer
mutuellement une fois qu'un mécanisme regarde plus large que l'élément lui-même. `pnpm turbo run
typecheck lint test` : 46/46 tâches, 674 tests au total. Conteneurs `browser-worker`/`web`
redémarrés (changement `apps/browser-worker` uniquement cette fois, `packages/browser-scripts`
inchangé).

## Explicitement hors périmètre à ce stade

- **WebSocket temps réel pour les exécutions/logs** (§17.12) — le moteur émet déjà des événements
  (`onEvent`) et le worker persiste des `ExecutionLog` au fil de l'exécution ; l'UI actuelle les
  affiche toujours par polling (1s), pas de relais en direct. **Levée uniquement pour la preview
  live du node `browserAction`** (streaming vidéo + enregistrement des actions), livrée en
  itération 10 — un transport WebSocket dédié à ce cas d'usage précis, pas un relais générique
  réutilisé pour les exécutions/logs.
- **Timezone/fenêtres d'exécution/limite de concurrence/priorités pour le scheduler** (§14,
  explicitement listées comme "évolutions futures") — le scheduler livré en itération 7 couvre le
  strict MVP (`manual`/`interval`/`hourly`/`daily`/`weekly`/`cron`), toujours en UTC (le défaut de
  BullMQ).
- **Node `browserAction` dans le corps d'une boucle** — la sémantique d'une session navigateur
  partagée ou relancée entre itérations est une vraie question de conception, volontairement
  reportée (voir `LoopBodyNodeSchema`'s doc comment).
- **Concurrence/scaling de `browser-worker` sous charge d'exécution** — chaque appel à
  `/session/run` lance son propre navigateur dédié (voir itération 9 ci-dessus), sans limite de
  concurrence globale côté service ; `worker` reste scalable (`--scale worker=3`) mais chaque
  réplique peut solliciter `browser-worker` sans coordination entre elles.
- **Garde-fou SSRF appliqué à `/render`** — le garde-fou de l'itération 9 protège `/session/run`
  et (depuis l'itération 10) `/session/live` ; `/render` (outil de preview, déclenché à la main)
  reste, comme avant, non protégé — écart identifié, pas corrigé ici.
- **`WHILE`** (§9.5) — explicitement V2 dans le cahier des charges (§25). `FOR EACH` est livré,
  scopé, en itération 6 (node `loop` — corps intégré, pas de boucle imbriquée, voir plus haut).
- **Sorties** Webhook/Database/CSV (§9.6) — V2 (§25).
- **XPath** comme stratégie d'extraction — le type existe, l'exécution lève une erreur explicite
  « planned for V2 ».
- **Credentials/Auth**, **application Electron** (§17.3, §24) — seule la coquille Electron reste à
  faire pour boucler la section 24 (MVP v1) ; Docker complet est livré (itération 8).
- **Drag-and-drop riche, undo/redo** dans l'éditeur visuel — **la mise en page (position des
  nodes) est désormais persistée**, levant partiellement cette entrée (voir itération 11
  ci-dessous) ; le reste (glisser-déposer depuis une palette externe, annuler/refaire) reste hors
  périmètre.
- **Authentification de proxy (utilisateur/mot de passe), proxies SOCKS** — le pool de proxies
  (itération 12) ne gère que `host`/`port` en HTTP simple ; `undici.ProxyAgent` et l'option `proxy`
  de Playwright supportent tous deux l'authentification nativement, mais aucun champ n'existe
  encore pour la fournir.
- **Distinguer un échec de proxy d'un échec de cible pour `browserAction`** — contrairement à
  `httpExecutor` (le throw d'undici ne survient qu'en cas d'échec réseau réel, jamais pour un 4xx/
  5xx normal), `browser-worker` renvoie la même réponse générique pour "le proxy est mauvais" et
  "la cible est mauvaise" ; l'itération 12 compte donc toujours un tel échec contre le proxy,
  documenté comme simplification délibérée plutôt que traité.
- **Proxy "sticky" par exécution** — chaque node en mode "proxy" réserve indépendamment ; deux
  nodes `http`/`browserAction` dans la même exécution peuvent se voir attribuer deux proxies
  différents. Pas de notion de session/proxy partagé sur la durée d'une exécution complète.

## Prochaines itérations (proposition, non engageante)

1. ~~Backend exécutable~~ — livré (itération 2).
2. ~~UI minimale~~ — livrée (itération 3).
3. ~~Preview HTML + sélection visuelle~~ — livrée (itération 4).
4. ~~Nodes de traitement de texte + menu contextuel de l'éditeur~~ — livré (itération 5).
5. ~~Preview JSON/XML + node Boucle~~ — livré (itération 6).
6. ~~Scheduler exécutable~~ — livré (itération 7).
7. ~~Docker complet~~ — livré (itération 8).
8. ~~Node Navigateur (`browserAction`), exécution batch~~ — livré (itération 9, Phase A).
9. ~~Node Navigateur : preview live (WebSocket + screencast CDP) + enregistrement des actions~~ —
   livré (itération 10, Phases B/C).
10. ~~Mise en page persistée (position des nodes)~~ — livré (itération 11).
11. ~~Pool de proxies global (nodes `http`/`browserAction`)~~ — livré (itération 12).
12. ~~Réordonner/réenregistrer une étape `browserAction` en place~~ — livré (itération 13).
13. **Coquille Electron**, dans l'esprit de la section 24 (MVP v1) — dernière pièce manquante avant
    ce jalon.

## Comment vérifier

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate   # une fois
cp .env.example .env
docker compose up -d postgres redis     # ou: pnpm infra:up
pnpm install                             # génère aussi le client Prisma
pnpm db:migrate                          # première migration (interactif la 1ère fois : --name init)
pnpm build
pnpm test        # 674 tests Vitest (unitaires + intégration moteur + e2e api/worker sur vrai Postgres/Redis)
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

# Environnement Docker complet (itération 8, §19-21) — alternative à tout ce qui précède,
# aucune installation locale de Node/pnpm nécessaire :
cp .env.example .env
docker compose up --build            # web (:5173), api (:3001), worker, browser-worker, postgres, redis
# Mode développement (hot reload) à la place :
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```
