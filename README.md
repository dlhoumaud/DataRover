# DataRover

![Logo DataRover](logo.png)

Un environnement de construction de pipelines autonomes de collecte et de traitement de données web.

> Explore the web. Capture the data.

Le cahier des charges complet du produit cible se trouve dans [`Specs.md`](./Specs.md). L'état
réel d'avancement (ce qui est implémenté vs le reste de la vision) est documenté dans
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## État actuel

Cette itération livre les **fondations du monorepo et le moteur de workflow**, sous forme de
packages TypeScript purs, testés unitairement — sans API, sans UI, sans Docker pour l'instant
(voir [`ARCHITECTURE.md`](./ARCHITECTURE.md) pour le détail et la feuille de route).

```text
packages/
├── shared              utilitaires communs (id, sleep, logger)
├── workflow-types       modèle métier partagé (Zod + types TS)
├── expression-engine    interpolation {{ }} + évaluateur d'expressions contrôlé
├── extractor            extraction CSS / JSONPath / XML / Regex
└── workflow-core        le moteur d'exécution de workflow

examples/
└── product-monitor      démo exécutable (scénario "Surveillance catalogue")
```

## Prérequis

- Node.js ≥ 20 (voir `.nvmrc`)
- pnpm ≥ 9 (via Corepack)

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

## Démarrage

```bash
pnpm install
pnpm build       # build tous les packages (tsup)
pnpm test        # tests Vitest (unitaires + intégration du moteur)
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit

# Démo end-to-end : GET → Extract → IF, rejouée avec le moteur réel
pnpm --filter @datarover/example-product-monitor start
```

## Licence

MIT — voir [`LICENSE`](./LICENSE).