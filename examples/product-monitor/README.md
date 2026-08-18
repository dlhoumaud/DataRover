# Product Monitor — exemple exécutable

Rejoue, avec le moteur réel `@datarover/workflow-core`, le scénario "Surveillance
catalogue" du cahier des charges (section 3) — dans les limites du MVP
livré. Le script `run.ts` démarre un mini-serveur `node:http` local qui sert
un fragment HTML `.product-card` (section 6), charge `workflow.json`, et
exécute le workflow : `GET /products` (html) → `extract` (CSS, listes
titres/prix) → `condition` sur le prix du premier produit → `stop` sur la
branche correspondante. Les événements du moteur (`onEvent`) sont affichés
au format `[HH:MM:SS] message`, dans l'esprit de la console d'exécution de
la section 15.

**Important — ce qui n'est PAS démontré ici** : le diagramme de la section 3
comporte une étape `FOR EACH produit` (itération sur chaque lien produit) et
une étape `Notification` (webhook/API/stockage). Le `FOR EACH` est un
exécuteur de boucle prévu en **V2**, pas encore implémenté dans
`WorkflowEngine` (registre par défaut : `http`, `extract`, `condition`,
`setVariable`, `stop` seulement) ; la notification est de même une action de
sortie qui n'existe pas encore. Cet exemple démontre donc le sous-ensemble
MVP réellement exécutable : **GET → Extract (liste) → IF sur le premier
élément**, avec deux nœuds `stop` en guise de point d'arrêt observable à la
place de la notification.

## Lancer l'exemple

Depuis la racine du monorepo, après installation des dépendances et
construction des packages dont dépend cet exemple :

```bash
pnpm install
pnpm build
pnpm --filter @datarover/example-product-monitor start
# (équivalent : pnpm --filter example-product-monitor start)
```

Le script se termine avec le code `0` si l'exécution du workflow est un
succès, `1` sinon (voir `execution.status` en sortie).
