# CLAUDE.md

Guide de développement pour le repository de widgets Grist.

---

## Instructions pour agents IA

**Ce repo suit une séparation stricte développement / production.**

### Règles essentielles

1. **Ne jamais modifier `published/`** sauf demande explicite de publication
2. **Développer dans `projects/`** — tous les projets sont dans ce dossier
3. **Chaque projet a son propre CLAUDE.md** — le lire avant toute intervention
4. **Le manifest.json est auto-généré** — ne jamais l'éditer manuellement
5. **Consulter `skills/`** — patterns de code réutilisables pour Grist

### Checklist avant de coder

```
□ Lire le CLAUDE.md du projet concerné
□ Consulter skills/ pour les patterns standards
□ Comprendre l'architecture existante
□ Identifier les fonctions/patterns déjà présents
□ Ne pas dupliquer ce qui existe
```

### Workflow de travail

```
DÉVELOPPEMENT                         PUBLICATION
─────────────────────────────────────────────────────────
projects/mon-widget/     ──promote──►  published/mon-widget/
    ├── fichiers.html                      ├── package.json (obligatoire)
    └── CLAUDE.md                          └── index.html
```

### Avant de coder sur un projet

1. Lire le `CLAUDE.md` du projet (ex: `projects/tasks_app/CLAUDE.md`)
2. Comprendre l'architecture existante
3. Ne pas publier sans demande explicite

### Quand l'utilisateur demande de "publier"

1. Créer `published/nom-widget/package.json` avec la section `grist`
2. Copier les fichiers finaux vers `published/nom-widget/`
3. Exécuter `npm run manifest` pour régénérer le catalogue
4. Commit avec message descriptif

### Conventions de code

- **Widgets statiques** : HTML autonome avec `<script src="grist-plugin-api.js">`
- **Français** pour les commentaires et messages utilisateur
- **Pas de frameworks** sauf si le projet le spécifie
- **grist.ready()** obligatoire avec `requiredAccess` approprié

---

## Vue d'ensemble

Ce repository contient des widgets personnalisés pour [Grist](https://www.getgrist.com/). Il est structuré pour supporter :
- Le **développement** de widgets (zone de travail)
- La **publication** de widgets stables (zone déployée sur GitHub Pages)
- Les deux types de widgets Grist : **statiques** (HTML pur) et **build** (npm/React)

## Structure du repository

```
Widgets-Grist/
├── .github/
│   ├── dependabot.yml            # Mises à jour actions et npm
│   └── workflows/
│       ├── ci.yml                # Lint, tests, tag SemVer, deploy GitHub Pages
│       └── codeql.yml            # Analyse statique
│
├── .nojekyll                     # Désactive Jekyll sur GitHub Pages
├── .gitignore
├── package.json                  # Config npm workspaces
├── CLAUDE.md                     # Ce fichier
├── README.md                     # Documentation publique
│
├── projects/                     # ZONE DE DÉVELOPPEMENT
│   ├── tasks_app/               # TaskFlow (kanban, gantt, calendar)
│   │   ├── CLAUDE.md
│   │   ├── kanban.html
│   │   ├── gantt.html
│   │   ├── calendar.html
│   │   └── ...
│   │
│   └── widget_app/              # Artefactory (IDE no-code)
│       ├── CLAUDE.md
│       ├── app.html
│       ├── app_runtime.html
│       └── templates/
│
├── published/                    # ZONE PUBLIÉE (déployée sur GitHub Pages)
│   ├── manifest.json            # Catalogue (généré, non versionné)
│   │
│   ├── taskflow/                # Widgets TaskFlow publiés
│   │   ├── package.json
│   │   ├── kanban/
│   │   │   └── index.html
│   │   ├── gantt/
│   │   │   └── index.html
│   │   └── calendar/
│   │       └── index.html
│   │
│   ├── artefactory/             # Widgets Artefactory publiés
│   │   ├── package.json
│   │   ├── admin/
│   │   │   └── index.html
│   │   ├── runtime/
│   │   │   └── index.html
│   │   ├── registry.json
│   │   └── components/
│   │       └── ...
│   │
│   └── [autres-widgets]/
│
├── packages/                     # WIDGETS AVEC BUILD (optionnel)
│   └── [widget-react]/
│       ├── package.json
│       ├── src/
│       └── dist/                # Output → copié dans published/
│
├── skills/                       # PATTERNS DE CODE RÉUTILISABLES
│   ├── README.md                # Index des skills
│   ├── schema.md                # ⭐ Création schéma (tables, colonnes, refs, labels)
│   ├── grist-api.md             # API Grist CRUD
│   ├── data-conversion.md       # Conversion colonaire, dates, RefList
│   ├── inter-widget.md          # Communication entre widgets
│   ├── bridge.md                # GristBridge pour iframes
│   └── patterns.md              # Modales, filtres, UI patterns
│
└── scripts/
    ├── build-inline.js          # Inline les sources .js dans les widgets HTML
    ├── check-commits.js         # Vérifie la convention des messages de commit
    ├── generate-manifest.js     # Génère manifest.json depuis published/
    ├── next-version.js          # Calcule le prochain tag SemVer
    └── promote.js               # Copie de projects/ vers published/
```

## Zones du repository

### `projects/` — Développement

Zone de travail pour les widgets en cours de développement. **Non déployée** sur GitHub Pages.

- Chaque projet a son propre `CLAUDE.md` avec les spécificités
- Les fichiers peuvent être testés localement (mode démo) ou via URL raw GitHub
- Pas de contrainte de structure stricte

### `published/` — Production

Zone des widgets stables publiés. **Déployée sur GitHub Pages** via CI/CD.

- Chaque widget a un `package.json` avec la section `grist` (métadonnées)
- Structure requise : `widget-name/index.html` (ou `widget-name.html`)
- Le `manifest.json` est généré par le script, pas versionné : ses URL dépendent de `BASE_URL`
- `lastUpdatedAt` vient du dernier commit touchant le dossier du widget, la génération est donc reproductible

### `packages/` — Widgets avec build

Pour les widgets nécessitant compilation (React, Vue, TypeScript...).

- Chaque package a son `package.json` avec scripts de build
- Le build output va dans `published/` via le script de build
- Utilise npm workspaces pour la gestion des dépendances

## Workflow de développement

### 1. Développer un widget

```bash
# Travailler dans projects/
cd projects/mon-widget/

# Tester localement (ouvrir dans navigateur = mode démo)
# Ou tester avec Grist via URL raw GitHub
```

### 2. Promouvoir vers published/

```bash
# Quand le widget est prêt
npm run promote -- mon-widget

# Ou manuellement : copier les fichiers vers published/
```

### 3. Publier

```bash
# Générer le manifest
npm run manifest

# Commit et push sur main
git add .
git commit -m "Publish mon-widget v1.0"
git push

# GitHub Actions déploie automatiquement sous /dev/
```

Pour mettre à jour la racine (version stable), créer une release GitHub. Voir la section CI/CD.

## Configuration Grist

### URL des widgets publiés

Deux versions sont servies en parallèle : la racine est figée sur la dernière release, `/dev/` suit `main`.

```
# stable (dernière release)
https://[USER].github.io/Widgets-Grist/taskflow/kanban/
https://[USER].github.io/Widgets-Grist/artefactory/runtime/

# nightly (main)
https://[USER].github.io/Widgets-Grist/dev/taskflow/kanban/
https://[USER].github.io/Widgets-Grist/dev/artefactory/runtime/
```

### Configurer comme source de widgets

Pour une instance Grist self-hosted, définir la variable d'environnement :

```bash
GRIST_WIDGET_LIST_URL=https://[USER].github.io/Widgets-Grist/manifest.json
# ou, pour la version nightly
GRIST_WIDGET_LIST_URL=https://[USER].github.io/Widgets-Grist/dev/manifest.json
```

Les widgets apparaîtront dans le sélecteur "Custom Widget" de Grist.

## Structure d'un widget

### Widget statique (sans build)

```
published/mon-widget/
├── package.json      # Métadonnées obligatoires
├── index.html        # Point d'entrée
├── style.css         # Optionnel
└── script.js         # Optionnel
```

**package.json minimal :**

```json
{
  "name": "@org/widget-mon-widget",
  "version": "1.0.0",
  "grist": {
    "widgetId": "@org/widget-mon-widget",
    "name": "Mon Widget",
    "url": "https://[USER].github.io/Widgets-Grist/mon-widget/",
    "accessLevel": "full",
    "description": "Description du widget"
  }
}
```

### Widget avec build (npm/React)

```
packages/mon-widget-react/
├── package.json
├── src/
│   ├── App.tsx
│   └── index.tsx
├── vite.config.ts
└── dist/             # → copié vers published/mon-widget-react/
```

**package.json :**

```json
{
  "name": "@org/widget-mon-widget-react",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build --outDir ../../published/mon-widget-react"
  },
  "grist": {
    "widgetId": "@org/widget-mon-widget-react",
    "name": "Mon Widget React",
    "url": "https://[USER].github.io/Widgets-Grist/mon-widget-react/",
    "accessLevel": "full"
  }
}
```

## Champs `grist` dans package.json

| Champ | Obligatoire | Description |
|-------|-------------|-------------|
| `widgetId` | Oui | Identifiant unique (format: `@org/widget-name`) |
| `name` | Oui | Nom affiché dans le sélecteur Grist |
| `url` | Oui | URL complète vers le widget |
| `accessLevel` | Non | `"none"`, `"read table"`, ou `"full"` |
| `description` | Non | Description courte (~125 caractères) |
| `renderAfterReady` | Non | Optimisation de rendu (défaut: true) |
| `authors` | Non | `[{ "name": "...", "url": "..." }]` |

## Commandes npm

```bash
# Installer les dépendances (workspaces)
npm install

# Lint JavaScript
npm run lint

# Générer le manifest.json
npm run manifest

# Promouvoir un widget de projects/ vers published/
npm run promote -- nom-du-projet

# Build tous les widgets (packages/)
npm run build

# Tout en un : build + manifest
npm run deploy
```

## CI/CD avec GitHub Actions

### `ci.yml` — contrôles, tag et déploiement

Sur chaque PR et chaque push sur `main` : lint des workflows (actionlint et zizmor), lint JavaScript
(ESLint), tests unitaires plus vérification du core inline, tests Playwright. Sur les PR uniquement, un job
vérifie que chaque message de commit suit Conventional Commits, puisque la version en dépend. En cas d'échec e2e, le rapport HTML et les traces sont
récupérables en artefact du run. Le job `tests` agrège ces trois jobs et fournit le contexte unique exigé
par le ruleset de `main` : ajouter ou renommer un job ne demande donc pas de toucher aux réglages du dépôt.

Quand ces trois jobs passent sur un push vers `main`, le job `tag` crée un tag annoté `vX.Y.Z`. La version
est calculée par `scripts/next-version.js` à partir des commits accumulés depuis le dernier tag stable :

| Commit | Incrément |
|--------|-----------|
| `type!: ...` ou footer `BREAKING CHANGE:` | MAJOR, minor et patch remis à 0 |
| `feat: ...` | MINOR, patch remis à 0 |
| tout le reste, y compris hors convention | PATCH |

Le bump le plus fort du lot l'emporte. Les tags de pre-release et les tags préfixés par widget
(`taskflow-v1.1.2`) sont ignorés dans le calcul de la base. Un tag posé par le workflow ne redéclenche
aucun autre workflow : rien n'est déployé ni publié à ce moment-là.

### GitHub Pages

Les jobs `pages-build` et `pages-deploy`, en fin de `ci.yml`, servent deux versions du site sur le même
domaine :

| Chemin | Contenu | Mis à jour par |
|--------|---------|----------------|
| `/` | version stable | publication d'une release GitHub |
| `/dev/` | version nightly | push sur `main` |

Ils dépendent de `tests` et ne tournent jamais sur une PR : rien n'est servi tant que les contrôles ne sont
pas verts. Chaque exécution reconstruit le site entier, la racine depuis le tag de la dernière release,
`/dev/` depuis `main`. Tant qu'aucune release n'existe, la racine est servie depuis `main` et le workflow
émet un avertissement.

Le manifest de `/dev/` est généré avec `BASE_URL` pointant sur le sous-chemin, pour que ses widgets référencent
bien les URL nightly.

### Lint JavaScript

`eslint.config.mjs` couvre les fichiers `.js` et, via `eslint-plugin-html`, le JavaScript en ligne des
widgets. Trois règles sont neutralisées sur le HTML, chacune pour une raison structurelle : `no-unused-vars`
parce que les fonctions appelées depuis un attribut `onclick` passeraient pour du code mort,
`no-useless-escape` parce que `<\/script>` doit rester échappé dans un script en ligne, et `no-undef` parce
que les bibliothèques arrivent par balise `script`.

### `codeql.yml` — analyse statique

CodeQL passe sur le JavaScript et sur les workflows eux-mêmes, à chaque PR, à chaque push sur `main` et une
fois par semaine. `published/` est exclu par `.github/codeql/config.yml` puisque c'est une copie de
`projects/`. Les alertes remontent dans l'onglet Security, elles ne bloquent pas le merge.

### Publier une version stable, et pourquoi un second run

Créer une release ne publie pas directement le site. Le run déclenché par l'événement `release`
tourne sur le tag, et le déploiement qu'il émet annonce à Pages une version identifiée par le **SHA
du commit**, pas par le contenu de l'artifact. Or ce commit a déjà été déployé au moment du merge,
avec une racine figée sur la release précédente. Pages voit donc la même version et continue de
servir l'ancien contenu, alors que le run se termine en succès. Constaté le 2026-08-10 puis le
2026-08-14, dans les deux cas résolu par un déploiement supplémentaire.

Le workflow s'en charge désormais seul : sur `release`, le job `republication` ne construit rien et
déclenche `ci.yml` sur `main` avec l'entrée `republier=true`. Ce second run saute les tests, déjà
joués sur ce commit, résout la dernière release, reconstruit le site et publie. Compter environ une
minute entre la création de la release et la mise en ligne.

`workflow_dispatch` fait partie des deux seuls événements qui créent un run même déclenchés par le
`GITHUB_TOKEN` du dépôt, avec `repository_dispatch` : c'est ce qui rend l'enchaînement possible sans
jeton personnel, et il n'y a pas de boucle à craindre puisqu'un run sur `main` ne crée pas de
release.

**Ne pas remettre les tests dans le run de republication** sans raison : ils rallongeraient la mise
en ligne de plusieurs minutes pour rejouer une validation déjà faite au merge et sur le tag.

### Publier une version stable

Les tags sont posés par la CI, la release reste manuelle. Choisir le tag à figer et créer la release
depuis ce tag :

```bash
gh release create v1.2.0 --generate-notes
```

Une release marquée pre-release (`--prerelease`) n'est jamais renvoyée par `releases/latest` et ne met donc
pas la racine à jour : c'est le canal pour faire tester une version candidate sans l'imposer aux
utilisateurs. Le tag correspondant porte alors un suffixe, par exemple `v1.2.0-rc.1`, que SemVer classe
en précédence inférieure à `v1.2.0`. Ce tag est à poser à la main, la CI ne produit que des versions stables.

### Configuration GitHub Pages

1. Settings → Pages
2. Source : GitHub Actions

L'environnement `github-pages` n'accepte les déploiements que depuis `main` et les tags `v*`.

### Réglages du dépôt

Les contrôles suivants sont actifs et valent la peine d'être connus avant de toucher à la CI :

- le jeton `GITHUB_TOKEN` est en lecture seule par défaut, chaque job déclare ce dont il a besoin ;
- seules les actions publiées par GitHub sont autorisées, plus `github/codeql-action`, et l'épinglage par
  SHA est imposé côté dépôt : une action référencée par tag est refusée à l'exécution ;
- analyse de secrets et protection au push actives ;
- alertes et correctifs Dependabot actifs, signalement privé de vulnérabilité ouvert ;
- `main` exige une PR, le rebase comme seule méthode de merge, et les checks `tests`, `Messages de commit`,
  `Analyse actions` et `Analyse javascript-typescript` ;
- les tags `v*` ne peuvent être ni supprimés ni réécrits.

## Conventions

### Nommage

- **Projets en dev** : `nom-projet/` ou `nom-projet-vX/` (avec version)
- **Widgets publiés** : `nom-widget/` (sans version, la version est dans package.json)
- **Widget IDs** : `@org/widget-nom-widget`

### Versioning

- Utiliser semver dans les `package.json`
- Le tag `vX.Y.Z` du dépôt est posé automatiquement à chaque push sur `main`, voir la section CI/CD
- Le manifest date chaque widget depuis l'historique git

### Commits

Conventional Commits, vérifié en CI sur les PR par `scripts/check-commits.js`. Types acceptés : `build`,
`chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`. En-tête limitée à
100 caractères.

```
feat(taskflow): add drag-drop to kanban
fix(artefactory): bridge timeout issue
docs: update CLAUDE.md
chore: bump versions
```

## Projets actuels

### TaskFlow (`projects/tasks_app/`)

Suite de 3 widgets Grist pour la gestion de projet :
- **Kanban** : Vue tableau avec drag & drop
- **Gantt** : Diagramme avec dépendances
- **Calendar** : Vue calendrier mensuel/hebdo

Voir `projects/tasks_app/CLAUDE.md` pour les détails.

### Artefactory (`projects/widget_app/`)

IDE no-code pour composer des applications Grist :
- **Admin** : Configurateur de manifest (à créer)
- **Runtime** : Exécuteur d'applications

Voir `projects/widget_app/CLAUDE.md` pour les détails.

## Guide de publication

### Étape par étape

#### 1. Préparer le widget

Le widget doit être fonctionnel et testé. Vérifier :
- [ ] Mode démo fonctionnel (ouverture locale)
- [ ] Intégration Grist fonctionnelle
- [ ] Pas d'erreurs console
- [ ] Responsive / utilisable

#### 2. Créer la structure dans published/

```bash
# Créer le dossier
mkdir -p published/mon-widget

# Créer le package.json (obligatoire)
```

**published/mon-widget/package.json :**
```json
{
  "name": "mon-widget",
  "version": "1.0.0",
  "description": "Description courte du widget",
  "grist": {
    "widgetId": "mon-widget",
    "name": "Mon Widget",
    "accessLevel": "full",
    "description": "Description affichée dans Grist"
  }
}
```

#### 3. Copier les fichiers

```bash
# Copier le HTML principal
cp projects/mon-widget/widget.html published/mon-widget/index.html

# Ou utiliser le script
npm run promote -- projects/mon-widget/widget.html mon-widget
```

#### 4. Générer le manifest

```bash
npm run manifest
```

Vérifie que le widget apparaît dans `published/manifest.json`.

#### 5. Commit et push

```bash
git add published/
git commit -m "feat: publish mon-widget v1.0.0"
git push
```

Le workflow GitHub Actions déploie automatiquement sous `/dev/`. La racine attend une release.

### Widgets multiples dans un package

Un seul `package.json` peut déclarer plusieurs widgets :

```json
{
  "name": "taskflow",
  "grist": [
    {
      "widgetId": "taskflow-kanban",
      "name": "TaskFlow Kanban",
      "url": "kanban/index.html",
      "accessLevel": "full"
    },
    {
      "widgetId": "taskflow-gantt",
      "name": "TaskFlow Gantt",
      "url": "gantt/index.html",
      "accessLevel": "full"
    }
  ]
}
```

### Mise à jour d'un widget

1. Modifier les fichiers dans `published/`
2. Incrémenter la version dans `package.json`
3. `npm run manifest` + commit + push

---

## Structure des CLAUDE.md par projet

Chaque projet dans `projects/` doit avoir son propre `CLAUDE.md` qui documente :

```markdown
# Projet: Nom du projet

## Contexte
[Objectif et cas d'usage]

## Architecture
[Structure des fichiers et leur rôle]

## Conventions spécifiques
[Règles propres au projet]

## État actuel
[Ce qui fonctionne, ce qui reste à faire]

## Points d'attention
[Pièges, bugs connus, décisions techniques]
```

Cela permet aux agents IA de comprendre rapidement le contexte sans avoir à explorer tout le code.

---

## Skills — Patterns de code

Le dossier `skills/` contient les patterns de code standard pour le développement Grist.

### Utilisation

**Avant de coder**, consulter le fichier approprié :

| Besoin | Fichier |
|--------|---------|
| **Créer tables/colonnes/refs** | `skills/schema.md` ⭐ |
| Lire/écrire des données Grist | `skills/grist-api.md` |
| Convertir les données colonaires | `skills/data-conversion.md` |
| Synchroniser plusieurs widgets | `skills/inter-widget.md` |
| Widget avec sous-iframes | `skills/bridge.md` |
| Modales, filtres, toasts | `skills/patterns.md` |

### Principes

1. **Réutiliser** les patterns existants plutôt que réinventer
2. **Cohérence** — même style de code dans tout le repo
3. **Documenter** les nouveaux patterns dans skills/

---

## Collaboration multi-agents / multi-sessions

Ce repo est conçu pour supporter le travail de **plusieurs agents IA** et **plusieurs utilisateurs** de manière cohérente.

### Architecture de documentation

```
CLAUDE.md (racine)           ← Règles globales, structure, workflow
    │
    ├── projects/*/CLAUDE.md ← Règles spécifiques par projet
    │
    └── skills/*.md          ← Patterns de code réutilisables
```

### Protocole pour un nouvel agent/session

1. **Lire ce fichier** (CLAUDE.md racine) en premier
2. **Identifier le projet** concerné par la demande
3. **Lire le CLAUDE.md du projet** avant toute intervention
4. **Consulter skills/** pour les patterns à utiliser
5. **Ne pas modifier** ce qui fonctionne sans raison explicite

### Règles de cohérence

#### Code
- Utiliser les **mêmes noms de fonctions** que dans les projets existants
- Respecter les **conventions de nommage** du projet
- Garder le **style de code** cohérent (indentation, commentaires, etc.)
- **Français** pour les messages utilisateur et commentaires

#### Patterns obligatoires pour widgets Grist
```javascript
// Initialisation standard
grist.ready({ requiredAccess: 'full' | 'read table' | 'none' });

// Conversion colonaire → objets (voir skills/data-conversion.md)
function convertToRows(data) { ... }

// Mode démo (fallback sans Grist)
try { grist.ready(...); } catch { isDemo = true; loadDemoData(); }

// Sélection inter-widgets (voir skills/inter-widget.md)
grist.setSelectedRows([id]);
grist.onRecord((record) => { ... });
```

#### Structure HTML standard
```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <script src="https://docs.getgrist.com/grist-plugin-api.js"></script>
    <style>/* CSS variables, styles */</style>
</head>
<body>
    <div id="app">Chargement...</div>
    <script>/* Code organisé en sections */</script>
</body>
</html>
```

### Communication entre sessions

Les sessions ne communiquent pas directement. La cohérence est assurée par :

1. **Documentation** — tout est documenté dans les CLAUDE.md
2. **Patterns** — utiliser les patterns de skills/
3. **Git** — les commits documentent les changements
4. **État actuel** — chaque CLAUDE.md de projet indique l'état

### Mise à jour de la documentation

Quand un agent fait un changement significatif :

1. **Mettre à jour le CLAUDE.md du projet** si l'architecture change
2. **Ajouter un pattern à skills/** si un nouveau pattern réutilisable est créé
3. **Documenter dans le commit** ce qui a été fait et pourquoi

### Anti-patterns à éviter

| Ne pas faire | Faire à la place |
|--------------|------------------|
| Modifier `published/` sans demande | Travailler dans `projects/` |
| Créer un nouveau pattern sans vérifier skills/ | Réutiliser les patterns existants |
| Changer l'architecture sans documenter | Mettre à jour le CLAUDE.md |
| Ignorer le CLAUDE.md du projet | Le lire en premier |
| Deviner le contexte | Lire le code et la doc existante |
| Dupliquer du code | Factoriser ou référencer |

---

## Repos de référence

Patterns additionnels disponibles dans les repos GitHub de nic01asfr :

| Repo | Contenu utile |
|------|---------------|
| [grist-widgets](https://github.com/nic01asfr/grist-widgets) | Geo-map, Cluster Quest, build React |
| [grist-navigation-widgets](https://github.com/nic01asfr/grist-navigation-widgets) | Navigation multi-widgets, setCursorPos |
| [Grist-App-Nest](https://github.com/nic01asfr/Grist-App-Nest) | Dashboard dynamique, React dans Grist |
| [mcp-server-grist](https://github.com/nic01asfr/mcp-server-grist) | MCP Server pour Grist |

---

## Ressources

- [Documentation Grist Custom Widgets](https://support.getgrist.com/widget-custom/)
- [Grist Plugin API](https://support.getgrist.com/code/modules/grist_plugin_api/)
- [gristlabs/grist-widget](https://github.com/gristlabs/grist-widget) (repo officiel)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
