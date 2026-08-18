# Architecture — état d'avancement

Ce document indique ce qui est **réellement implémenté** dans ce dépôt, par opposition à ce que
décrit [`Specs.md`](./Specs.md) (le cahier des charges complet du produit cible). Il est mis à
jour à chaque itération.

> Principe directeur (Specs.md, section 27/28) : *« Construire d'abord un moteur de workflow
> fiable et un modèle de données propre. L'éditeur visuel vient représenter ce moteur, il ne doit
> pas le définir. »* Cette itération livre exactement cette base : le moteur, pas encore l'UI.

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

Le moteur est une **librairie pure**, agnostique de toute UI/API/queue : `new WorkflowEngine().run(definition, options)` s'exécute en test, en script, ou demain depuis une API/CLI — conformément à la section 16 (« exécuté depuis l'interface, via API, exporté, importé, sans interface graphique à terme »).

Le modèle `WorkflowDefinition` utilise volontairement `nodes` + `edges` (pas de pointeurs `next` imbriqués) : c'est le modèle natif de React Flow, donc le futur éditeur visuel (§10, §17.2) pourra se brancher directement dessus sans traduction, conformément au principe « Same Data Model » de la section 27.

**Vérifié** : `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` passent tous sans erreur (234 tests unitaires/intégration, 0 warning de lint) ; l'exemple `examples/product-monitor` s'exécute de bout en bout avec succès.

## Explicitement hors périmètre de cette itération

Ces éléments existent dans le cahier des charges mais ne sont **pas** implémentés ici — ce n'est
pas un oubli, c'est le périmètre volontairement choisi pour cette itération (voir le plan
d'implémentation approuvé) :

- **API NestJS** (`apps/api`), **Prisma/PostgreSQL**, **Redis/BullMQ**, **worker(s)** dédiés (§14, §17.4–17.6) — le moteur existe mais n'est pas encore exposé via HTTP/queue.
- **UI React** (`apps/web`) — éditeur visuel React Flow, preview HTML + sélection visuelle d'éléments, gestion graphique des variables, dashboard, historique (§6, §10, §11, §17.2).
- **WebSocket temps réel** pour les logs/statuts (§17.12) — le moteur émet déjà des événements (`onEvent`) prêts à être relayés, mais rien ne les relaie encore.
- **Scheduler exécutable** (§14) — les types `Schedule`/`ScheduleType` existent dans `workflow-types`, mais aucun cron/planificateur ne tourne.
- **Browser crawling / Playwright** (§5, §17.9) — seul le crawler HTTP (Undici) est implémenté ; pas d'exécuteur `browser`.
- **`FOR EACH` / `WHILE`** (§9.5) — explicitement V2 dans le cahier des charges (§25) ; l'exemple `product-monitor` documente cette limite en commentaire.
- **Sorties** Webhook/Database/CSV (§9.6) — V2 (§25) ; seul un nœud `stop` permet de terminer une branche pour l'instant.
- **XPath** comme stratégie d'extraction — le type existe dans le schéma (`ExtractStrategyType`), mais son exécution lève une erreur explicite « planned for V2 » (V2 selon §25).
- **Credentials/Auth**, **Docker**, **application Electron** (§17.3, §19–22, §24) — aucun de ces éléments n'a été démarré.

## Prochaines itérations (proposition, non engageante)

1. **Backend exécutable** : `apps/api` (NestJS + Fastify), Prisma/PostgreSQL pour persister `Project`/`Workflow`/`Execution`, `apps/worker` (BullMQ) consommant `@datarover/workflow-core` — testable en HTTP façon Postman.
2. **UI minimale** : `apps/web` (Vite + React Flow) branché sur le même modèle `WorkflowDefinition`, avec exécution manuelle et logs en direct (WebSocket).
3. **Preview HTML + sélection visuelle**, **scheduler exécutable**, puis **Docker complet** et **coquille Electron**, dans l'esprit de la section 24 (MVP v1).

## Comment vérifier

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate   # une fois
pnpm install
pnpm build       # build tous les packages (tsup, ESM+CJS+d.ts)
pnpm test        # 234 tests Vitest (unitaires + intégration moteur)
pnpm lint        # ESLint flat config, 0 erreur/warning
pnpm typecheck   # tsc --noEmit sur tous les packages

# Démo end-to-end (scénario "Surveillance catalogue", cahier des charges §3) :
pnpm --filter @datarover/example-product-monitor start
```
