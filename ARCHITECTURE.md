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

## Explicitement hors périmètre à ce stade

- **WebSocket temps réel** (§17.12) — le moteur émet déjà des événements (`onEvent`) et le worker
  persiste des `ExecutionLog` au fil de l'exécution ; l'UI actuelle les affiche par polling (1s),
  pas de relais en direct.
- **Timezone/fenêtres d'exécution/limite de concurrence/priorités pour le scheduler** (§14,
  explicitement listées comme "évolutions futures") — le scheduler livré en itération 7 couvre le
  strict MVP (`manual`/`interval`/`hourly`/`daily`/`weekly`/`cron`), toujours en UTC (le défaut de
  BullMQ).
- **Browser crawling / Playwright pour l'exécution des workflows** (§5, §17.9) — le moteur
  (`packages/workflow-core`, exécuteur `http`) reste strictement HTTP (Undici). `apps/browser-
  worker` (itération 8) reste scopé à l'outil de preview interactif de l'éditeur — une exécution de
  workflow réelle ne rend toujours jamais de JS.
- **`WHILE`** (§9.5) — explicitement V2 dans le cahier des charges (§25). `FOR EACH` est livré,
  scopé, en itération 6 (node `loop` — corps intégré, pas de boucle imbriquée, voir plus haut).
- **Sorties** Webhook/Database/CSV (§9.6) — V2 (§25).
- **XPath** comme stratégie d'extraction — le type existe, l'exécution lève une erreur explicite
  « planned for V2 ».
- **Credentials/Auth**, **application Electron** (§17.3, §24) — seule la coquille Electron reste à
  faire pour boucler la section 24 (MVP v1) ; Docker complet est livré (itération 8).
- **Drag-and-drop riche, undo/redo, mise en page persistée** dans l'éditeur visuel — la position
  des nodes est recalculée à chaque chargement (voir itération 3 ci-dessus), pas sauvegardée.

## Prochaines itérations (proposition, non engageante)

1. ~~Backend exécutable~~ — livré (itération 2).
2. ~~UI minimale~~ — livrée (itération 3).
3. ~~Preview HTML + sélection visuelle~~ — livrée (itération 4).
4. ~~Nodes de traitement de texte + menu contextuel de l'éditeur~~ — livré (itération 5).
5. ~~Preview JSON/XML + node Boucle~~ — livré (itération 6).
6. ~~Scheduler exécutable~~ — livré (itération 7).
7. ~~Docker complet~~ — livré (itération 8).
8. **Coquille Electron**, dans l'esprit de la section 24 (MVP v1) — dernière pièce manquante avant
   ce jalon.

## Comment vérifier

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate   # une fois
cp .env.example .env
docker compose up -d postgres redis     # ou: pnpm infra:up
pnpm install                             # génère aussi le client Prisma
pnpm db:migrate                          # première migration (interactif la 1ère fois : --name init)
pnpm build
pnpm test        # 443 tests Vitest (unitaires + intégration moteur + e2e api/worker sur vrai Postgres/Redis)
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
