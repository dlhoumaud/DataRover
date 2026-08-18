# Cahier des charges — DataRover

## 1. Vision du projet

### Nom de travail

**DataRover**

> Explore the web. Capture the data.

### Positionnement

DataRover est un environnement visuel permettant de construire, exécuter, planifier et orchestrer des pipelines d'extraction de données web.

Le produit ne doit pas être conçu comme un simple outil de scraping. Le crawling constitue un moyen d'acquisition de données au sein d'un moteur de workflow plus large.

Le produit se situe conceptuellement à l'intersection de :

* un client HTTP inspiré de Postman ;
* un moteur de workflow visuel ;
* un navigateur automatisé ;
* un système d'extraction de données ;
* un scheduler ;
* un moteur conditionnel et événementiel.

L'objectif est de permettre à un utilisateur de construire visuellement des scénarios tels que :

```text
GET page
    ↓
Extraction d'un identifiant
    ↓
POST vers une API avec cet identifiant
    ↓
Extraction d'une liste
    ↓
FOR EACH
    ↓
Condition
   /      \
TRUE     FALSE
 ↓         ↓
Webhook   Continue
```

---

# 2. Concepts métier

L'organisation générale du système repose sur la structure suivante :

```text
Projet
    ↓
Variables globales
    ↓
Workflow
    ↓
Actions
    ↓
Conditions
    ↓
Transformations
    ↓
Sorties
```

Un projet peut contenir un ou plusieurs workflows.

Chaque workflow est composé d'actions interconnectées.

```text
Project
├── Variables globales
├── Credentials
├── Workflows
│   ├── Actions
│   ├── Conditions
│   ├── Transformations
│   └── Outputs
├── Schedules
└── Execution History
```

---

# 3. Exemple de projet

```text
Projet : Surveillance catalogue

├── Variables globales
│   ├── baseUrl
│   ├── apiKey
│   └── lastExecutionDate
│
├── Workflow : Product Monitor
│
│   ├── Action 1 : Initialisation
│   │   └── Définition des variables
│   │
│   ├── Action 2 : GET /products
│   │   ├── Type : HTML
│   │   └── Extraction : liens produits
│   │
│   ├── Action 3 : FOR EACH produit
│   │   └── GET /product/{id}
│   │
│   ├── Action 4 : Extraction
│   │   ├── Nom
│   │   ├── Prix
│   │   └── Disponibilité
│   │
│   ├── Action 5 : Condition
│   │
│   │   Si prix < ancien_prix
│   │
│   └── Action 6 : Notification
│       └── Webhook / API / stockage
│
└── Scheduler
    └── Tous les jours à 08:00
```

---

# 4. Fonctionnalités principales

## 4.1 Gestion des projets

L'utilisateur doit pouvoir :

* créer un projet ;
* modifier un projet ;
* supprimer un projet ;
* dupliquer un projet ;
* exporter un projet ;
* importer un projet ;
* gérer les variables globales ;
* consulter l'historique des exécutions.

Un projet constitue l'unité principale de travail.

---

## 4.2 Éditeur de requêtes HTTP

L'application doit proposer une interface inspirée des fonctions essentielles de Postman.

Types de requêtes supportés initialement :

```text
GET
POST
PUT
PATCH
DELETE
```

Chaque requête peut contenir :

```text
URL
Query Parameters
Headers
Body
Authentication
Timeout
Variables
Retry Policy
```

Exemple :

```text
Method: POST

URL:
https://api.example.com/orders

Headers:
Authorization: Bearer {{ actions.login.output.token }}

Body:
{
  "userId": "{{ actions.getUser.output.id }}"
}
```

---

# 5. Types de crawling

Le système doit proposer plusieurs modes d'acquisition.

## HTTP

Pour les ressources accessibles directement :

```text
HTML
JSON
XML
Text
File
```

## Browser

Pour les sites nécessitant l'exécution de JavaScript ou des interactions navigateur :

```text
Navigation
Click
Fill form
Wait
Scroll
Cookies
Authentication
JavaScript execution
```

Les deux modes doivent être distincts :

```text
HTTP Crawler
    ↓
Rapide
Faible consommation
HTML / JSON / XML

Browser Crawler
    ↓
JavaScript
Interactions
Navigation complexe
Plus coûteux
```

Le navigateur ne doit pas être utilisé lorsqu'une simple requête HTTP est suffisante.

---

# 6. Preview et sélection visuelle HTML

Pour les réponses HTML, l'application doit permettre d'afficher une prévisualisation de la page.

Workflow :

```text
URL
 ↓
GET
 ↓
Récupération HTML
 ↓
Prévisualisation
 ↓
Mode sélection
 ↓
L'utilisateur clique sur un élément
 ↓
Génération de sélecteurs
 ↓
Prévisualisation des résultats
 ↓
Validation
```

Exemple :

```html
<div class="product-card">
    <span class="title">Produit A</span>
    <span class="price">29.99 €</span>
</div>
```

Le système doit pouvoir proposer :

```text
Nom :
product_name

Selector :
.product-card .title

Résultat :
[
  "Produit A",
  "Produit B",
  "Produit C"
]
```

La prévisualisation HTML doit être isolée dans un environnement sécurisé.

Le système doit notamment éviter :

* l'exécution non contrôlée de scripts ;
* l'accès non autorisé au contexte de l'application ;
* l'interaction non maîtrisée entre la page inspectée et l'éditeur.

---

# 7. Système d'extraction

Les stratégies d'extraction suivantes doivent être prévues.

## HTML

```text
CSS Selector
XPath
Extraction d'attribut
Extraction de texte
Extraction de liste
Extraction de table
```

## JSON

```text
JSONPath
Sélection par chemin
```

## XML

```text
XPath
Transformation XML → structure exploitable
```

## Général

```text
Regex
Transformation
Expression JavaScript contrôlée
```

---

# 8. Selector fallback

Un élément sélectionné ne doit pas nécessairement dépendre d'un seul sélecteur.

Exemple :

```text
1. [data-testid="price"]
2. .product-card .price
3. //div[contains(@class, "price")]
```

Le système doit pouvoir tester plusieurs stratégies.

Un score de robustesse peut être affiché :

```text
[data-testid="price"]       95/100
.product-card .price        80/100
div > span:nth-child(3)     15/100
```

L'objectif est d'éviter la dépendance excessive aux sélecteurs fragiles tels que :

```text
div > div:nth-child(4) > span:nth-child(2)
```

---

# 9. Actions du workflow

Chaque action possède une structure générique :

```text
Action
├── id
├── name
├── type
├── input
├── output
├── variables
├── conditions
├── retry policy
├── timeout
└── next actions
```

## 9.1 Actions réseau

```text
GET
POST
PUT
PATCH
DELETE
```

## 9.2 Actions de crawling

```text
HTTP
HTML
JSON
XML
Browser
```

## 9.3 Actions d'extraction

```text
CSS Selector
XPath
JSONPath
Regex
Attribute
Text
List
Table
```

## 9.4 Actions de transformation

```text
Map
Filter
Format
Split
Join
Date parsing
Data mapping
JavaScript expression
```

## 9.5 Contrôle du flux

```text
IF
ELSE
FOR EACH
WHILE
WAIT
RETRY
STOP
```

## 9.6 Actions de sortie

```text
JSON
CSV
Database
Webhook
API
File
Notification
```

---

# 10. Éditeur visuel de workflow

L'interface doit proposer un éditeur graphique de type node-based.

Exemple :

```text
┌──────────────┐
│ GET Products │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Extract IDs  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   FOR EACH   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ GET Product  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│     IF       │
└────┬────┬────┘
     │    │
   TRUE  FALSE
```

L'éditeur visuel est une représentation du workflow.

Il ne constitue pas la source de vérité métier.

La source de vérité doit être un modèle de workflow indépendant de l'interface.

---

# 11. Interface générale

L'interface peut être structurée autour de trois zones.

```text
┌────────────────────────────────────────────────────────────┐
│ PROJECT: Product Monitor         ▶ Run    ⏱ Schedule       │
├───────────────┬───────────────────────────┬────────────────┤
│               │                           │                │
│ ACTIONS       │       WORKSPACE           │ VARIABLES      │
│               │                           │                │
│ + HTTP        │      Workflow             │ productId      │
│ + Browser     │                           │ category       │
│ + Extract     │    [GET Products]         │ authToken      │
│ + Condition   │           ↓               │                │
│ + Loop        │    [Extract IDs]          │ OUTPUT         │
│               │           ↓               │                │
│               │      [FOR EACH]           │ products[]     │
│               │           ↓               │                │
│               │    [GET Product]          │                │
│               │                           │                │
└───────────────┴───────────────────────────┴────────────────┘
```

L'éditeur doit notamment permettre :

* drag and drop ;
* connexion entre actions ;
* zoom ;
* déplacement ;
* duplication ;
* suppression ;
* regroupement logique ;
* affichage des erreurs ;
* affichage de l'état d'exécution.

---

# 12. Gestion des variables

Le système doit gérer plusieurs scopes.

```text
Global
Project
Workflow
Action
Iteration
Runtime
```

Syntaxe prévue :

```text
{{ global.baseUrl }}

{{ actions.login.output.token }}

{{ actions.getProduct.output.id }}

{{ item.url }}
```

Exemple :

Action :

```text
GET /user
```

Résultat :

```json
{
  "id": 123
}
```

Action suivante :

```text
POST /orders
```

Body :

```json
{
  "userId": "{{ actions.getUser.output.id }}"
}
```

L'interface doit permettre de sélectionner graphiquement les variables disponibles.

L'utilisateur ne doit pas être obligé de connaître ou mémoriser tous les chemins.

---

# 13. Conditions

Le système doit proposer un mode visuel simple.

Exemple :

```text
IF

{{ product.price }} < {{ global.targetPrice }}

THEN

→ Webhook
→ Database

ELSE

→ Continue
```

Un mode avancé doit permettre l'utilisation d'expressions.

Exemple :

```text
product.price < global.targetPrice
&& product.available === true
```

Principe :

> Interface visuelle pour les cas standards, expressions pour les cas avancés.

---

# 14. Scheduler

Le MVP doit proposer :

```text
Manual
Every X minutes
Hourly
Daily
Weekly
Cron
```

Chaque déclenchement doit créer une nouvelle exécution.

Architecture logique :

```text
Scheduler
    ↓
Create Execution
    ↓
Queue
    ↓
Worker
    ↓
Workflow Runtime
```

Évolutions futures :

* timezone ;
* fenêtres d'exécution ;
* durée maximale ;
* retry ;
* exponential backoff ;
* limite de concurrence ;
* priorités ;
* file d'attente.

---

# 15. Historique et observabilité

Chaque exécution doit être enregistrée.

Informations minimales :

```text
Execution ID
Workflow ID
Status
Started At
Finished At
Duration
Logs
Action Results
Errors
```

Statuts :

```text
Pending
Running
Success
Failed
Cancelled
Retrying
```

Exemple de console :

```text
[10:22:01] Workflow started

[10:22:02] GET /products
[10:22:03] HTTP 200

[10:22:03] Extract products
[10:22:03] 42 items extracted

[10:22:04] FOR EACH started

[10:22:05] Item 1 completed
[10:22:06] Item 2 completed

[10:22:10] Workflow completed
```

Les logs doivent pouvoir être affichés en temps réel.

---

# 16. Moteur de workflow

Le cœur du produit doit être indépendant de l'interface graphique.

Le système repose sur un moteur d'exécution capable de lire une définition déclarative.

Exemple conceptuel :

```json
{
  "project": {
    "name": "Product Monitor",
    "variables": {
      "baseUrl": "https://example.com"
    }
  },
  "workflow": {
    "nodes": [
      {
        "id": "get-products",
        "type": "http",
        "method": "GET",
        "url": "{{ global.baseUrl }}/products"
      },
      {
        "id": "extract-products",
        "type": "extract",
        "source": "get-products",
        "selectors": {
          "name": ".product-name",
          "price": ".price"
        }
      },
      {
        "id": "check-price",
        "type": "condition",
        "expression": "{{ item.price < 50 }}"
      }
    ]
  }
}
```

Le workflow doit pouvoir être :

* exécuté depuis l'interface ;
* exécuté via API ;
* exporté ;
* importé ;
* versionné ;
* exécuté sans interface graphique à terme.

---

# 17. Architecture technique

## 17.1 Langage principal

Le projet sera développé principalement en :

```text
TypeScript
```

L'objectif est de partager les types et modèles entre :

```text
Frontend
API
Workflow Engine
Workers
Shared Packages
```

---

## 17.2 Frontend

Stack retenue :

```text
React
TypeScript
Vite
React Flow
TanStack Query
Zustand
React Hook Form
Zod
Tailwind CSS
```

Responsabilités :

* gestion des projets ;
* éditeur visuel ;
* configuration des actions ;
* éditeur de requêtes ;
* preview HTML ;
* sélection visuelle ;
* gestion des variables ;
* logs ;
* historique d'exécution ;
* dashboard.

React Flow est utilisé pour la représentation graphique des workflows.

Le modèle métier reste indépendant de React Flow.

---

## 17.3 Application Desktop

L'application desktop sera développée avec :

```text
Electron
React
TypeScript
```

Electron constituera la couche desktop permettant d'embarquer l'interface React dans une application native distribuable.

Architecture :

```text
Electron
    │
    ├── React UI
    │
    ├── Desktop integration
    │
    └── Local runtime / process management
```

L'application desktop devra permettre notamment :

* lancement de l'application sans navigateur externe ;
* accès aux fonctionnalités du système de fichiers ;
* gestion des projets locaux ;
* intégration avec les processus locaux ;
* notifications système ;
* gestion du clipboard ;
* ouverture de fenêtres et vues dédiées ;
* intégration avec les outils de développement.

L'interface React utilisée dans Electron doit rester découplée de l'environnement Electron.

Le code métier et le moteur de workflow ne doivent pas dépendre directement d'Electron.

L'objectif est de conserver une architecture permettant potentiellement de proposer :

```text
DataRover Web
DataRover Desktop
DataRover CLI
```

à partir du même socle logiciel.

---

## 17.4 Backend API

Stack :

```text
Node.js
TypeScript
NestJS
Fastify
```

Responsabilités :

```text
Projects
Workflows
Executions
Variables
Credentials
Schedules
Authentication
API
WebSocket
```

---

## 17.5 Base de données

Stack :

```text
PostgreSQL
Prisma
```

Entités principales :

```text
Project
Workflow
WorkflowVersion
Execution
ExecutionLog
Schedule
Credential
```

Les définitions de workflow peuvent être stockées en JSON/JSONB.

---

## 17.6 Queue et workers

Stack :

```text
Redis
BullMQ
```

Architecture :

```text
API
 │
 │ Create Execution
 ▼
Redis Queue
 │
 ├── Worker HTTP
 ├── Worker Browser
 └── Worker Workflow
```

Les workers doivent être séparés de l'API.

L'API ne doit pas exécuter directement les crawlers.

---

## 17.7 Crawling HTTP

Stack :

```text
Undici
```

Utilisation :

* API ;
* HTML statique ;
* JSON ;
* XML ;
* téléchargements.

---

## 17.8 Parsing HTML

Stack :

```text
Cheerio
```

Utilisation :

* CSS Selectors ;
* extraction de texte ;
* extraction d'attributs ;
* analyse HTML.

---

## 17.9 Browser automation

Stack :

```text
Playwright
```

Utilisation :

* pages JavaScript ;
* SPA ;
* navigation ;
* interactions ;
* authentification ;
* cookies ;
* formulaires ;
* scroll ;
* clics.

Playwright doit être exécuté dans des workers dédiés.

---

## 17.10 JSON

Support :

```text
JSONPath
```

---

## 17.11 XML

Stack :

```text
fast-xml-parser
```

Le MVP peut transformer XML en structure JavaScript exploitable avant extraction.

---

## 17.12 Temps réel

Communication temps réel :

```text
WebSocket
```

Utilisation :

* logs ;
* progression ;
* statut des actions ;
* erreurs ;
* résultats intermédiaires.

---

# 18. Architecture du monorepo

Le projet doit être organisé sous forme de monorepo.

Structure cible :

```text
datarover/

├── apps/
│   │
│   ├── web/
│   │   └── React frontend
│   │
│   ├── desktop/
│   │   └── Electron application
│   │
│   ├── api/
│   │   └── NestJS API
│   │
│   └── worker/
│       └── Workflow execution
│
├── packages/
│   │
│   ├── workflow-core/
│   │   └── Workflow engine
│   │
│   ├── workflow-types/
│   │   └── Shared TypeScript types
│   │
│   ├── extractor/
│   │   └── HTML / JSON / XML extraction
│   │
│   ├── expression-engine/
│   │   └── Variables and conditions
│   │
│   └── shared/
│       └── Shared utilities
│
├── docker/
│
├── docker-compose.yml
│
├── .env.example
│
└── package.json
```

Outil de monorepo recommandé :

```text
Turborepo
```

---

# 19. Environnement Docker

Le projet doit être entièrement exécutable via Docker.

Objectif :

> Un développeur doit pouvoir récupérer le dépôt et démarrer l'environnement avec un minimum de configuration.

Commande cible :

```text
docker compose up --build
```

L'environnement doit inclure au minimum :

```text
┌────────────────────────────┐
│        Docker Network      │
│                            │
│  ┌──────────┐              │
│  │   Web    │              │
│  │  React   │              │
│  └────┬─────┘              │
│       │                    │
│  ┌────▼─────┐              │
│  │   API    │              │
│  │ NestJS   │              │
│  └─┬─────┬──┘              │
│    │     │                 │
│    │     ├─────────────┐   │
│    ▼                   ▼   │
│ PostgreSQL           Redis │
│                            │
│  ┌──────────────────────┐  │
│  │       Worker         │  │
│  │ HTTP / Workflow      │  │
│  └──────────────────────┘  │
│                            │
│  ┌──────────────────────┐  │
│  │   Browser Worker     │  │
│  │     Playwright       │  │
│  └──────────────────────┘  │
│                            │
└────────────────────────────┘
```

Services Docker prévus :

```text
web
api
worker
browser-worker
postgres
redis
```

L'application Electron constitue une application cliente desktop et n'est pas un service Docker.

---

# 20. Services Docker

## web

Responsabilité :

```text
React frontend
```

Port de développement prévu :

```text
3000 ou 5173
```

---

## api

Responsabilité :

```text
REST API
WebSocket
Project management
Workflow management
Execution management
```

Port prévu :

```text
3001
```

---

## worker

Responsabilité :

```text
Workflow runtime
HTTP actions
Extraction
Conditions
Transformations
Queue processing
```

Le service peut être scalable horizontalement.

Exemple :

```text
docker compose up --scale worker=3
```

---

## browser-worker

Responsabilité :

```text
Playwright
Browser automation
JavaScript rendering
Navigation
Interactions
```

Ce service doit être séparé du worker HTTP afin d'isoler les processus plus lourds.

---

## postgres

Responsabilité :

```text
Persistence
Projects
Workflows
Executions
Logs
Schedules
```

Les données doivent être persistées via un volume Docker.

---

## redis

Responsabilité :

```text
Queue
Jobs
Delayed jobs
Retries
Runtime state
```

---

# 21. Configuration Docker

Le dépôt doit fournir :

```text
docker-compose.yml
docker-compose.dev.yml
.env.example
Dockerfile
Dockerfile.dev
```

La configuration doit permettre deux usages.

## Mode développement

```text
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Objectifs :

* hot reload frontend ;
* hot reload backend ;
* logs accessibles ;
* volumes montés ;
* PostgreSQL local ;
* Redis local.

## Mode production

```text
docker compose up -d
```

L'environnement doit pouvoir être utilisé comme base de déploiement self-hosted.

---

# 22. Variables d'environnement

Le fichier `.env.example` doit fournir les variables nécessaires.

Exemple :

```text
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=datarover
POSTGRES_USER=datarover
POSTGRES_PASSWORD=datarover

REDIS_HOST=redis
REDIS_PORT=6379

API_PORT=3001

WEB_PORT=3000

NODE_ENV=development
```

Les secrets ne doivent jamais être commités.

---

# 23. Architecture d'exécution

Le cycle d'exécution doit être :

```text
User
 │
 │ Run Workflow
 ▼
API
 │
 │ Create Execution
 ▼
PostgreSQL
 │
 │ Queue Job
 ▼
Redis
 │
 ▼
Workflow Worker
 │
 ├── HTTP
 ├── Browser
 ├── Extraction
 ├── Transformation
 ├── Condition
 └── Output
 │
 ▼
Execution Result
 │
 ├── PostgreSQL
 │
 └── WebSocket
        │
        ▼
      Frontend
```

Dans le cas de l'application Electron :

```text
Electron
   │
   ▼
React UI
   │
   ▼
API
   │
   ▼
Workflow Runtime
```

L'application desktop ne doit pas modifier le modèle d'exécution du workflow.

---

# 24. MVP — Version 1

La première version doit volontairement rester limitée.

## Fonctionnalités obligatoires

1. Création de projet.
2. Variables globales.
3. Workflow.
4. Action HTTP GET.
5. Action HTTP POST.
6. Gestion des headers.
7. Gestion des query parameters.
8. HTML.
9. JSON.
10. Preview HTML.
11. Sélection visuelle d'éléments.
12. Génération de CSS Selector.
13. Extraction de données.
14. Variables entre actions.
15. Conditions IF.
16. Scheduler simple.
17. Exécution manuelle.
18. Historique des exécutions.
19. Logs d'exécution.
20. Environnement Docker complet.
21. Application desktop Electron.

---

# 25. Version 2

Évolutions prévues :

```text
Playwright
Browser automation
FOR EACH
Authentication complexe
Cookies
Proxy
Retry avancé
Parallélisation
XPath
JSONPath avancé
Transformations
Webhooks
Database output
CSV
```

---

# 26. Version 3

Évolutions avancées :

```text
Collaboration
Gestion des utilisateurs
Gestion des rôles
Versioning
Git integration
API publique
CLI
Headless execution
Templates
Marketplace
Plugin system
AI workflow generation
AI selector repair
AI extraction assistant
```

---

# 27. Principe architectural fondamental

Le frontend ne doit jamais être considéré comme le moteur du produit.

L'architecture doit respecter :

```text
                    Workflow Definition
                           │
            ┌──────────────┴──────────────┐
            │                             │
            ▼                             ▼
      Visual Editor                  Workflow Runtime
       React Flow                         Worker
            │                             │
            └──────────────┬──────────────┘
                           │
                           ▼
                    Same Data Model
```

Le workflow doit pouvoir exister et être exécuté indépendamment de l'interface.

Cette séparation permettra ultérieurement :

* une API ;
* une CLI ;
* une exécution headless ;
* du CI/CD ;
* du versioning ;
* de l'export ;
* de l'import ;
* des templates ;
* une génération automatisée par IA ;
* une application desktop Electron.

L'application Electron doit être considérée comme une **couche de distribution et d'intégration desktop**, et non comme une dépendance du moteur métier.

---

# 28. Objectif final

DataRover doit devenir une plateforme permettant de construire visuellement des pipelines d'acquisition et de traitement de données web.

La promesse fonctionnelle peut être résumée ainsi :

> Configurer une source, sélectionner les données, enchaîner les actions, définir les conditions et automatiser l'exécution.

L'architecture technique cible est :

```text
                    ┌───────────────────┐
                    │   React / Web UI   │
                    └─────────┬─────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Electron Desktop   │
                    │     (optionnel)    │
                    └─────────┬─────────┘
                              │
                              ▼
                     ┌────────────────┐
                     │   NestJS API   │
                     └───────┬────────┘
                             │
               ┌─────────────┼─────────────┐
               │             │             │
               ▼             ▼             ▼
          PostgreSQL       Redis      WebSocket
                             │
                             ▼
                    ┌────────────────┐
                    │ Workflow Worker│
                    └───────┬────────┘
                            │
                 ┌──────────┼──────────┐
                 ▼          ▼          ▼
              Undici     Cheerio   Playwright
                 │          │          │
                 └──────────┼──────────┘
                            ▼
                       Web / APIs
```

L'ensemble doit être disponible dans un environnement Docker permettant le développement local, les tests et un futur déploiement self-hosted.

L'application Electron doit permettre de distribuer DataRover comme application desktop tout en réutilisant le frontend React, les modèles TypeScript et le moteur de workflow communs.

Le principe directeur reste le suivant :

> Construire d'abord un moteur de workflow fiable et un modèle de données propre. L'éditeur visuel vient représenter ce moteur, il ne doit pas le définir.

> **React constitue l'interface. Electron constitue la distribution desktop. Docker constitue l'environnement d'exécution et de développement. Le Workflow Engine constitue le cœur du produit.**
