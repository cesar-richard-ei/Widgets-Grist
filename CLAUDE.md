# CLAUDE.md

Guide de développement pour le repository de widgets Grist.

---

## Instructions pour agents IA

**Le site servi se construit depuis `projects/` : il n'y a pas de copie de publication à tenir à jour.**

### Règles essentielles

1. **Un merge sur `main` est servi sous `/dev/`** (la qualif) : ne merger que ce qui peut y partir
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
projects/tasks_app/fiche.html  ──site.json──►  site/taskflow/fiche/index.html
                                                 ├── /dev/ : main, à chaque push
                                                 └── racine : dernière release
```

### Avant de coder sur un projet

1. Lire le `CLAUDE.md` du projet (ex: `projects/tasks_app/CLAUDE.md`)
2. Comprendre l'architecture existante
3. Garder en tête qu'un merge sur `main` part en qualif

### Ajouter un fichier au site

1. Le déclarer dans `site.json`, sous le dossier servi qui le porte
2. Pour un nouveau widget, décrire son entrée dans le catalogue du projet (`catalogue.json`, section `grist`)
3. `npm run site` construit le site dans `site/` : vérifier le fichier et le `manifest.json`

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
│
├── site.json                     # Ce que sert GitHub Pages : dossier servi → source de projects/
├── site/                         # Site construit par scripts/build-site.js (non versionné)
│
├── packages/                     # WIDGETS AVEC BUILD (optionnel)
│   └── [widget-react]/
│       ├── package.json
│       ├── src/
│       └── dist/                # Output, déclaré dans site.json
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
    └── build-site.js            # Construit site/ depuis projects/ et génère manifest.json
```

## Zones du repository

### `projects/` — Développement

Zone de travail pour les widgets en cours de développement. **Non déployée** sur GitHub Pages.

- Chaque projet a son propre `CLAUDE.md` avec les spécificités
- Les fichiers peuvent être testés localement (mode démo) ou via URL raw GitHub
- Pas de contrainte de structure stricte

### `site.json` et `site/` — Ce qui est servi

`site.json` décrit le site servi par GitHub Pages : pour chaque dossier servi, quel fichier de
`projects/` va à quel chemin, et le catalogue qui décrit ses widgets à Grist. `scripts/build-site.js`
le lit, copie les fichiers dans `site/` et génère `manifest.json`.

- `site/` n'est pas versionné : `pages.yml` le reconstruit à chaque déploiement
- Une source déclarée qui n'existe pas fait échouer la construction, et le test unitaire `build-site`
- `lastUpdatedAt` vient du dernier commit touchant les sources du dossier, la génération est donc reproductible

### `packages/` — Widgets avec build

Pour les widgets nécessitant compilation (React, Vue, TypeScript...).

- Chaque package a son `package.json` avec scripts de build
- Le build output est déclaré dans `site.json`
- Utilise npm workspaces pour la gestion des dépendances

## Workflow de développement

### 1. Développer un widget

```bash
# Travailler dans projects/
cd projects/mon-widget/

# Tester localement (ouvrir dans navigateur = mode démo)
# Ou tester avec Grist via URL raw GitHub
```

### 2. Publier

Merger sur `main` : `pages.yml` reconstruit le site et le sert sous `/dev/`, la qualif. Pour la racine,
servie en prod, créer une release. Voir la section CI/CD.

## Configuration Grist

### URL des widgets publiés

Deux versions sont servies en parallèle : la racine est figée sur la dernière release, `/dev/` suit `main`.

```
# stable (dernière release)
https://[USER].github.io/Widgets-Grist/taskflow/gantt/

# nightly (main)
https://[USER].github.io/Widgets-Grist/dev/taskflow/gantt/
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
projects/mon-widget/
├── catalogue.json    # Entrée du catalogue Grist
├── mon-widget.html   # Point d'entrée, servi en mon-widget/index.html
└── CLAUDE.md
```

Puis dans `site.json` :

```json
"mon-widget": {
    "catalogue": "projects/mon-widget/catalogue.json",
    "fichiers": { "index.html": "projects/mon-widget/mon-widget.html" }
}
```

**catalogue.json minimal :**

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
└── dist/             # déclaré dans site.json
```

**package.json :**

```json
{
  "name": "@org/widget-mon-widget-react",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "grist": {
    "widgetId": "@org/widget-mon-widget-react",
    "name": "Mon Widget React",
    "url": "https://[USER].github.io/Widgets-Grist/mon-widget-react/",
    "accessLevel": "full"
  }
}
```

## Champs `grist` du catalogue

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

# Construire le site dans site/, manifest compris
npm run site

# Servir le site construit en local
npm run serve

# Build tous les widgets (packages/)
npm run build
```

## CI/CD avec GitHub Actions

### `ci.yml` — contrôles et nightly

Sur chaque PR et chaque push sur `main` : lint des workflows (actionlint et zizmor), lint JavaScript
(ESLint), tests unitaires plus vérification du core inline, tests Playwright. Sur les PR uniquement, un job
vérifie que chaque message de commit suit Conventional Commits, puisque la version en dépend. En cas d'échec e2e, le rapport HTML et les traces sont
récupérables en artefact du run. Le job `tests` agrège ces trois jobs et fournit le contexte unique exigé
par le ruleset de `main` : ajouter ou renommer un job ne demande donc pas de toucher aux réglages du dépôt.

Quand `tests` passe sur un push vers `main`, `ci.yml` appelle `pages.yml`, qui republie le site. Rien
d'autre : `main` n'est pas tagué, et la racine n'est mise à jour que par une release.

### `pages.yml` — construction et déploiement du site

Workflow réutilisable, appelé par `ci.yml` après les tests sur `main` et par `release.yml` après la
création d'une release. Il écoute en plus l'événement `release: published`, qui rattrape les releases
publiées à la main depuis l'interface. Tous les chemins passent par la même construction, il n'y a donc
pas deux recettes à garder synchronisées.

| Chemin | Contenu | Mis à jour par |
|--------|---------|----------------|
| `/` | dernière release | exécution de `release.yml`, ou release publiée à la main |
| `/dev/` | nightly | push sur `main` |

Chaque exécution reconstruit le site entier, la racine depuis le tag de la dernière release, `/dev/`
depuis `main`. Tant qu'aucune release n'existe, la racine est servie depuis `main` et le workflow émet
un avertissement.

Chaque arbre est construit par son propre `scripts/build-site.js` à partir de son `site.json`. Une
release antérieure à `site.json` (v1.30.0 et avant) n'en a pas : son dossier `published/` est alors
servi tel quel, avec le générateur de manifest de l'époque.

Le manifest de `/dev/` est généré avec `BASE_URL` pointant sur le sous-chemin, pour que ses widgets
référencent bien les URL nightly. Chaque page reçoit une estampille substituée à
`__VERSION_TASKFLOW__` : le tag à la racine, la sortie de `git describe --tags` pour la nightly, par
exemple `v1.19.2-12-gbfa201d`, qui donne la distance à la dernière version livrée.

### `release.yml` — livrer en production

Déclenchement manuel depuis l'onglet Actions, sur `main`. C'est le seul chemin qui crée une release,
donc le seul qui met la racine du site à jour.

`semantic-release` analyse les commits accumulés depuis le dernier tag, en déduit la version, pose le
tag annoté et crée la release avec ses notes :

| Commit | Incrément |
|--------|-----------|
| `type!: ...` ou footer `BREAKING CHANGE:` | MAJOR, minor et patch remis à 0 |
| `feat: ...` | MINOR, patch remis à 0 |
| `fix`, `perf`, `revert` | PATCH |
| `build`, `chore`, `ci`, `docs`, `refactor`, `style`, `test` | aucune version |

Le bump le plus fort du lot l'emporte. Un lot composé uniquement de la dernière ligne ne produit rien :
le run le signale et s'arrête, sans republier le site.

`@semantic-release/github` commente ensuite chaque PR incluse dans la version et lui pose le label
`livré`. La file de vérification produit se lit donc `is:merged label:"A tester" -label:livré`.

L'entrée `simulation` du déclenchement passe `--dry-run` : la version calculée et les notes
s'affichent dans le run, rien n'est publié.

La configuration tient dans `.releaserc.json`. Ni `changelog` ni `git` parmi les plugins : rien n'est
commité sur `main`, les notes de release sont le seul journal. Les dépendances vivent dans
`.github/release/package.json`, séparées du manifeste principal pour ne pas alourdir le `npm ci` des
jobs de test et de construction du site.

**Une release créée par un workflow ne déclenche aucun autre workflow**, puisqu'elle est émise avec le
`GITHUB_TOKEN` du dépôt. C'est pourquoi `release.yml` appelle `pages.yml` lui-même plutôt que de
s'appuyer sur l'événement `release`. Ce même événement couvre le cas inverse : une release publiée à la
main depuis l'interface republie la racine sans passer par le workflow. Les deux chemins ne se
recouvrent donc jamais.

### Lint JavaScript

`eslint.config.mjs` couvre les fichiers `.js` et, via `eslint-plugin-html`, le JavaScript en ligne des
widgets. Trois règles sont neutralisées sur le HTML, chacune pour une raison structurelle : `no-unused-vars`
parce que les fonctions appelées depuis un attribut `onclick` passeraient pour du code mort,
`no-useless-escape` parce que `<\/script>` doit rester échappé dans un script en ligne, et `no-undef` parce
que les bibliothèques arrivent par balise `script`.

### `codeql.yml` — analyse statique

CodeQL passe sur le JavaScript et sur les workflows eux-mêmes, à chaque PR, à chaque push sur `main` et une
fois par semaine. Les alertes remontent dans l'onglet Security, elles ne bloquent pas le merge.

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
- Le tag `vX.Y.Z` du dépôt ne marque que les versions livrées, voir la section CI/CD
- Le manifest date chaque widget depuis l'historique git

### Commits

Conventional Commits, vérifié en CI sur les PR par `scripts/check-commits.js`. Types acceptés : `build`,
`chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`. En-tête limitée à
100 caractères.

```
feat(taskflow): add drag-drop to kanban
fix(taskflow): volet chantier sans planning
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

## Guide de publication

1. Le widget fonctionne en mode démo et dans Grist, sans erreur console
2. Ses fichiers sont déclarés dans `site.json`, son entrée dans le catalogue du projet
3. `npm run site` construit le site sans erreur et le `manifest.json` l'annonce
4. Merger sur `main` : il est servi sous `/dev/`
5. Vérifier la page servie et le widget dans le document Grist de qualif
6. Release pour la racine, puis la même vérification en prod

Un catalogue peut déclarer plusieurs widgets : `grist` est alors un tableau, chaque `url` étant
relative au dossier servi (`kanban/`, `gantt/`...).

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
| Dire qu'un widget est livré après le merge | Vérifier la page servie et le widget dans Grist |
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
