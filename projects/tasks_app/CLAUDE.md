# CLAUDE.md — TaskFlow

Guide de développement pour la suite de widgets **TaskFlow** (Grist).

---

## Vue d'ensemble

**TaskFlow v15/v16** est une suite de 5 widgets custom Grist pour la gestion de projets/tâches. Tous partagent les mêmes tables et fonctionnent en concert dans le même document Grist.

| Widget | Fichier | Version | Rôle |
|--------|---------|---------|------|
| Kanban | `kanban.html` | v15 | Vue colonnes drag & drop, widget maître (init schéma) |
| Gantt | `gantt.html` | v15 | Timeline avec dépendances et vues multiples |
| Calendar | `calendar.html` | v15 | Calendrier mensuel/hebdo/compact avec barres adaptatives |
| Dashboard | `dashboard.html` | v16 | Dashboard composable avec composants configurables |
| **Plan** | `plan.html` | v16 | **Plan de charge** : heatmap capacité/charge par personne, prévu/réalisé/reste/dispo, timeline, allocation éditable (**opt-in**, voir plus bas) |
| **Fiche** | `fiche.html` | v16 | **Fiche d'un projet** : cadrage (responsable, sponsors, contributeurs clés, description, budget, commanditaires) puis feuille de route de ses chantiers sur six mois. Lecture seule, lié à `Projects` |

Chaque widget est un **fichier HTML autonome** avec CSS et JS inline. Pas de framework — vanilla JS/HTML5/CSS3.

### Code partagé (core inliné)

Le code commun (conversions, dates, statuts dynamiques, calcul de charge, `chargeMatrix`…) vit dans **`core/taskflow-core.js`** (objet global `TF`) et est **inliné** dans chaque widget par `scripts/build-inline.js` entre les marqueurs `// <inline:core/taskflow-core.js>` / `// </inline>`.

- Modifier le core → `npm run build:inline` régénère les cibles (kanban/gantt/calendar/dashboard/plan + whiteboard).
- Le script du Gantt vit dans `gantt.js` et suit le même chemin : éditer le `.js`, jamais le bloc généré dans le HTML.
- `npm run check:inline` vérifie que tout est en phase (utilisé en validation/CI).
- **Ne jamais éditer la zone entre les marqueurs à la main** — éditer `core/taskflow-core.js` puis rebuild.

### Statuts dynamiques (`statusCfg`)

Les statuts ne sont **plus** une enum hardcodée : ils sont lus depuis les Choices réels de la colonne `Tasks.statut` via `TF.loadStatusConfig()` → `statusCfg.byValue[v] = {value, label, fillColor, textColor}`, `statusCfg.terminalValue`, `TF.isTerminal(cfg, value)`. Le dernier statut est considéré « terminal » (clôture). Aucune valeur de statut n'est codée en dur.

### Convention `?nav`

La barre de navigation inter-widgets (bas d'écran, pour passer d'une vue à l'autre) n'apparaît **que si l'URL du widget contient `?nav`** (cas « TaskFlow racine » / page suite). Sans `?nav`, chaque widget est autonome (pas de barre). Activé via `if (new URLSearchParams(location.search).has('nav')) document.body.classList.add('suite-nav')`.

---

## Architecture commune

### Structure d'un fichier

```
<style>          CSS variables :root + styles
HTML body        Header, contenu principal, panel slide-in, overlay, toasts
<script>
  ├── Constantes     CATALOG, STATUS_CONFIG, PRIORITY_COLORS, TOOLTIP_FIELDS...
  ├── État global    let tasks=[], team=[], projects=[], selectedTaskId, panelState
  ├── Utils          escapeHtml, dateToGrist, gristToDate, formatDate, getRefListArray...
  ├── Filtres        filters{}, toggleFilterValue(), getFilteredTasks(), broadcastFilters()
  ├── Panel          openPanel(), closePanel(), openTaskPanel(), openCreatePanel(), renderPanelTask()
  ├── CRUD           saveTaskToGrist(), createTask(), deleteTask()
  ├── Sous-tâches    getSubtasks(), subtasksToJson(), addSubtask(), toggleSubtask(), removeSubtask()
  ├── Rendu          render() + fonctions spécifiques au widget
  ├── Export         exportPrint(), exportPNG()
  └── Init Grist     initGrist(), ensureSchema(), loadAllData(), seedData()
```

### Panel slide-in (pattern commun aux 3 widgets actifs)

```javascript
let panelState = { open: false, isNew: false, taskId: null, taskIndex: -1, editData: null };

openTaskPanel(taskId)   // ouvre avec données existantes
openCreatePanel(opts)   // ouvre vierge (preset statut/projet)
closePanel()            // ferme avec confirmation si modifications
renderPanelTask()       // rafraîchit le DOM du panel depuis editData
saveTaskToGrist()       // UpdateRecord ou AddRecord selon isNew
```

### Filtres inter-widgets (GEN-02)

Les filtres sont diffusés entre widgets via `grist.widgetApi.setOptions()` + `grist.onOptions()`.

```javascript
// Émission (dans toggleFilterValue)
function broadcastFilters() {
    grist.widgetApi?.setOptions({ filters });
}

// Réception (dans initGrist)
grist.onOptions((options) => {
    if (options?.filters) { applyExternalFilters(options.filters); render(); }
});
```

**Important Dashboard :** les filtres du dashboard sont locaux (in-memory) et ne passent PAS par `setOptions` pour éviter une boucle de re-rendu. Seule la config layout est persistée.

### Sélection inter-widgets (GEN-01)

```javascript
// Émission au clic tâche
selectedTaskId = taskId;
grist.setSelectedRows([taskId]);

// Réception depuis un autre widget
grist.onRecord((record) => {
    selectedTaskId = record?.id;
    // highlight DOM
});
```

### Auto-schema (TASKFLOW_SCHEMA)

Le widget Kanban est **widget maître** : il crée automatiquement les 3 tables à l'init. Les autres widgets vérifient et complètent les colonnes manquantes.

> **Exception opt-in** : les colonnes du plan de charge (`charges`, `dateCloture`, `capaciteHebdo`, `indispos`) ne sont **pas** créées par Kanban/Gantt/Calendar/Dashboard — **seul le widget Plan les crée** (voir section « Plan de charge — opt-in »). Les autres widgets ne les écrivent que si elles existent déjà.

```javascript
const TASKFLOW_SCHEMA = {
    Tasks: [...],    // voir schéma complet ci-dessous
    Team: [...],
    Projects: [...]
};

async function ensureSchema() {
    // 1. fetchTable() → table existe ?
    // 2. Non → AddTable avec toutes les colonnes
    // 3. Oui → AddColumn pour chaque colonne manquante
    // 4. Tasks créée → seedData() avec exemples
    // 5. TF.ensureUntiedLabels() → délie colId ↔ label (voir ci-dessous)
}
```

#### Renommage des libellés sans casse (`untieColIdFromLabel`)

Le widget lit et écrit **tout par colId**. Or Grist régénère le colId à chaque changement de libellé tant que la colonne n'est pas *déliée* (`untieColIdFromLabel = false` par défaut) : renommer un libellé casse alors le widget (données lues sous une clé absente, `ensureSchema` recrée une colonne vide en doublon).

`TF.ensureUntiedLabels(grist, { Tasks:[...], Team:[...], Projects:[...] })` pose `untieColIdFromLabel = true` sur les colonnes du schéma. Appelé depuis `ensureSchema` (Kanban/Gantt/Calendar), idempotent (saute les colonnes déjà déliées) et défensif. Une fois délié, l'utilisateur renomme les libellés dans Grist sans impact sur le widget.

> **Limite** : une colonne déjà renommée *avant* ce correctif a déjà perdu son colId d'origine ; le widget ne peut pas la remapper automatiquement, remise à la main nécessaire une fois.

---

## Schéma des données

### Table `Tasks` (centrale)

| Colonne | Type Grist | Notes |
|---------|------------|-------|
| `titre` | Text | Titre de la tâche |
| `description` | Text | Corps / détail |
| `statut` | Choice | `todo` / `inprogress` / `review` / `done` |
| `priorite` | Int | 1=Critique, 2=Haute, 3=Moyenne, 4=Basse |
| `type` | Choice | `tache` / `jalon` / `reunion` |
| `progression` | Int | 0-100 (%) |
| `dateDebut` | Date | Timestamp Unix (÷1000 pour JS) |
| `dateEcheance` | Date | Timestamp Unix (÷1000 pour JS) |
| `projet` | Ref:Projects | Référence projet |
| `assignees` | RefList:Team | Liste d'assignés (format `['L', id1, id2]`) |
| `dependDe` | RefList:Tasks | Dépendances fin→début (prédécesseurs) |
| `dependDebutDe` | RefList:Tasks | Dépendances début→début. **Colonne opt-in**, aucun widget ne la crée — voir « Deux types de lien » |
| `tags` | ChoiceList | Étiquettes libres |
| `estimationH` | Numeric | Estimation en heures |
| `tempsPasse` | Numeric | Temps réellement passé |
| `couleur` | Text | Couleur personnalisée hex |
| `subtasks` | Text | **JSON** : `[{id, text, done}]` (FUT-01) |
| `parentTask` | Ref:Tasks | Décomposition WBS (hiérarchie) — voir section WBS |
| `charges` | Text | **JSON** `[{teamId, heures}]` — répartition de charge par assigné. **Colonne opt-in** créée par le widget Plan |
| `dateCloture` | Date | Date de clôture (posée auto au passage en statut terminal, effacée si réouverture) → réalisé/délai. **Colonne opt-in** créée par le widget Plan |

### Table `Team`

| Colonne | Type | Notes |
|---------|------|-------|
| `nom` | Text | |
| `email` | Text | |
| `role` | Choice | |
| `actif` | Bool | |
| `couleur` | Text | **Couleur hex de l'avatar** (modifiable via picker Kanban) |
| `capaciteHebdo` | Numeric | Capacité hebdomadaire en heures. **Colonne opt-in** créée par le widget Plan |
| `indispos` | Text | **JSON** `[{start, end, label}]` — congés/indispos. **Colonne opt-in** créée par le widget Plan |

### Table `Projects`

| Colonne | Type | Notes |
|---------|------|-------|
| `nom` | Text | |
| `couleur` | Text | Couleur hex de la pastille |
| `dateDebut` | Date | |
| `dateFin` | Date | |
| `responsable` | Ref:Team | |
| `actif` | Bool | |

---

## Conversion des données

```javascript
// Colonaire Grist → tableau d'objets
// { titre: ['A','B'], statut: ['todo','done'] }
// → [{ titre:'A', statut:'todo' }, { titre:'B', statut:'done' }]

// Dates (CRITIQUE : timestamps Unix en secondes, pas en ms)
const gristToDate = (ts) => ts ? new Date(ts * 1000) : null;
const dateToGrist  = (d)  => d  ? Math.floor(d.getTime() / 1000) : null;

// RefList → tableau d'IDs numériques
const getRefListArray = (val) => Array.isArray(val) && val[0]==='L' ? val.slice(1).map(Number) : [];
const toGristRefList  = (arr) => arr?.length ? ['L', ...arr] : null;

// ChoiceList → tableau de strings
const getChoiceListArray = (val) => Array.isArray(val) && val[0]==='L' ? val.slice(1) : [];
const toGristChoiceList  = (arr) => arr?.length ? ['L', ...arr] : null;
```

---

## Fonctionnalités par widget

### Kanban (v15)
- Vue colonnes par statut avec drag & drop (Sortable.js)
- Panel slide-in création/édition tâche
- Sous-tâches checklist (JSON dans colonne `subtasks`) — **FUT-01**
- Jauge progression cliquable (0-100% par incrément)
- Filtre assigné + statut
- Picker couleur membres Team (10 presets, `UpdateRecord 'Team'`) — **A15**
- Export Print/PDF + PNG (html2canvas CDN) — **GEN-03**

### Gantt (v15)
- Timeline avec 6 vues : semaine / mois / trimestre / semestre / année / 5 jours
- Vue par défaut Semestre (en mémoire, non persistée entre sessions)
- Texte hors bande pour barres étroites
- Tooltip configurable au survol (`TOOLTIP_FIELDS`)
- Filtre assigné + projet + priorité + domaine. Le **domaine** d'une personne est son équipe (`Team.Domaine`, colonne facultative que le widget ne crée pas ; `Team.role` est un libellé d'affichage, vide sur le document du métier) : une ligne est retenue dès qu'une personne du domaine la touche, par elle-même ou par son chantier. Le projet ne fait pas entrer ses lignes : une personne posée dessus suffisait à ramener des chantiers et des tâches sans lien direct. Le groupe disparaît du menu si aucun membre ne porte de domaine
- Sous-tâches dans panel — **FUT-01**
- Bouton discret « replier toutes les tâches » dans l'en-tête de la colonne (fermeture seule, visible seulement quand une branche est dépliée)
- Duplication depuis le volet : reprend les champs et le rattachement, la copie s'ouvre pour être renommée. Les sous-tâches ne suivent pas, dupliquer une branche entière n'a pas été demandé. Absent sur un chantier
- Un seul bouton de création, « + Ajouter », qui ouvre un menu Tâche / Chantier. Sans table `Chantiers` il n'y a rien à choisir : le clic crée directement une tâche
- Une seule tête par ligne, celle du responsable (à défaut le premier assigné), le reste de l'équipe dans un compteur « +X »
- Barre d'outils sur une seule ligne sous 560px, logo et nom de la vue masqués, défilement horizontal pour le reste
- Jalon déplaçable à la souris dans le graphique. Seul le déplacement est ouvert : un jalon n'a qu'une date, il n'y a rien à redimensionner
- Couleurs avatars membres depuis `couleur` Team — **TEAM-01**
- Pas d'export ni d'ajustement de la vue : la barre d'outils ne garde que la navigation, la couleur, les filtres et la création. `fitToTasks` calait la vue sur la tâche la plus ancienne et basculait en vue Année, ce qui envoyait l'utilisateur des années en arrière d'un clic ; la fonction a été retirée avec le bouton

### Calendar (v15)
- 7 vues : mois / semaine / 2 semaines / 5 jours / trimestre / semestre / année
- **Barres adaptatives** : 4 niveaux de détail selon espace disponible par lane
  - `compact` (< 20px) : titre seul
  - `medium` (20-34px) : titre + badge statut
  - `tall` (34-52px) : titre + statut + avatars assignés
  - `full` (52px+) : titre + statut + plage dates + avatars
- Hauteur des rows proportionnelle au nombre de tâches, remplissage complet
- Sous-tâches dans panel — **FUT-01**
- Couleurs avatars membres — **TEAM-01**
- Export Print/PDF + PNG — **GEN-03**

### Dashboard (v16)
- 8 types de composants : KPI, Donut, Barres, Liste, Équipe, Échéances, Projets, Vélocité
- Grille CSS 4 colonnes, col-span 1-4 par composant
- Mode édition : accordion inline pour configuration de chaque composant
- Filtres locaux (période, projet, assigné, statut) — **non persistés**
- Config layout persistée via `grist.widgetApi.setOptions({ dash: dashConfig })`
- Garde `_saving` flag pour éviter boucle `onOptions` ↔ `setOptions`

### Fiche (v16) — fiche d'un projet

Widget **lié à la table `Projects`** : il ne travaille que sur l'enregistrement sélectionné, reçu par
`onRecord`. Lecture seule de bout en bout, aucune écriture, aucun volet, aucune poignée.

- **Périmètre.** Seule une ligne de catégorie `Projet` ouvre une fiche ; un produit ou une offre de
  service affiche un message qui nomme sa catégorie. La catégorie se porte tantôt en `Ref` vers une
  table, tantôt en `Choice` selon les documents : la valeur suffit à trancher, un identifiant étant
  un nombre et un choix une chaîne.
- **Cadrage.** Responsable, sponsors et contributeurs clés en pastilles, description, budget alloué,
  commanditaires et deadline. Une colonne vide se dit « Non renseigné » plutôt que de laisser un blanc.
- **Feuille de route.** Les chantiers du projet, chacun suivi de ses tâches, sur une fenêtre fixe de
  six mois qui va du premier du mois précédent au dernier du cinquième suivant. Les chantiers se
  replient.
- **Fenêtre et colonnes.** Les colonnes sont des semaines : la fenêtre s'ouvre donc au lundi de la
  première et se ferme au dimanche de la dernière. Mesurer les positions depuis le premier du mois
  les décalerait d'une colonne, la ligne du jour comprise.
- **Positions en pourcentage.** `TF.computeBarGeometry` sert un Gantt qui défile et travaille en
  pixels ; ici la fenêtre est fixe et suit la largeur de l'écran, une position relative la rend
  responsive sans recalcul au redimensionnement.
- La ligne du jour est portée par un calque qui ne couvre que la piste, jamais par le corps entier :
  la colonne des libellés la décalerait de plusieurs semaines.
- **L'enregistrement est demandé brut.** `onRecord` développe les références et décode les dates par
  défaut : le responsable arrivait sous son nom au lieu de son identifiant, et les trois blocs de
  personnes affichaient « Non renseigné » sur le document du métier. Le widget passe donc
  `{ expandRefs: false, keepEncoded: true, includeColumns: 'normal' }`, pour recevoir les mêmes
  valeurs que les tables lues par `fetchTable`.
- **De l'enregistrement servi, seul l'identifiant est fiable.** `onRecord` délègue à
  `fetchSelectedRecord`, que le serveur exécute avec sa propre lecture des options : le responsable
  arrivait tantôt sous son nom, tantôt sous une forme illisible, quand les listes gardaient leurs
  identifiants. La fiche relit donc le projet dans `Projects` comme elle lit les autres tables, et
  ne garde de l'enregistrement que la ligne sélectionnée. La résolution d'une personne accepte
  encore l'identifiant ou le libellé, et journalise sous `[fiche]` ce qui reste introuvable.
- **La table des personnes n'est pas nommée en dur.** Chaque colonne dit dans son type où pointent
  ses références (`Ref:Team`, `RefList:Autre`) ; la fiche lit ces tables et indexe les personnes par
  table et identifiant. Une catégorie sans fiche annonce celle qui vient plutôt que de décrire ce
  que le widget ne fait pas.

### Plan (v16) — plan de charge

- **Heatmap** capacité vs charge par ressource × période (semaine/mois), groupable par **Personne / Projet / Chantier / Rôle** (Projet/Chantier/Rôle = en-tête + sous-lignes par membre)
- **Modes** : Prévu / Réalisé / Reste / **Dispo** (voir modèle ci-dessous)
- Unités **% / h**, options **Inclure terminé / Estimer / Jours ouvrés**
- **Allocation éditable** (drill sur cellule) : heures, %, **réaffectation** entre membres, **replanification** des dates — écriture réelle dans `Tasks.charges` / dates
- **Panneau ressource** : capacité hebdo + indisponibilités (`Team.capaciteHebdo` / `Team.indispos`)
- **Timeline par personne** (panneau bas) : tâches en barres, drag = replan/réaffectation, aperçu de tâche au clic
- Export CSV (COPIL), filtres partagés (`onOptions`), modale de confirmation **interne** (jamais `confirm()` natif)

---

## Plan de charge — opt-in & modèle prévu/réalisé

### Opt-in (sweet spot) : le Plan n'impose rien

Le widget **Plan est le créateur UNIQUE** de ses colonnes : `Tasks.charges`, `Tasks.dateCloture`, `Team.capaciteHebdo`, `Team.indispos`. Il les crée à l'ouverture si manquantes (`ensurePlanColumns`).

Les autres widgets (Kanban/Gantt/Calendar/Dashboard) **ne créent aucune** de ces colonnes et **n'activent leurs bouts « charge » que si la colonne existe** :

```javascript
let TASK_COLS = new Set();          // colonnes réelles de Tasks, lues du fetch (loadAllData)
function pruneTaskRecord(rec) {       // retire d'un record toute colonne absente ; fail-open si TASK_COLS vide
  if (TASK_COLS.size) { for (const k in rec) if (!TASK_COLS.has(k)) delete rec[k]; }
  return rec;
}
// appliqué à saveTaskToGrist + createTask + drag → jamais d'écriture d'une colonne inexistante
// section "Charge par personne" du panneau rendue seulement si TASK_COLS.has('charges')
```

**Conséquence** : un document qui n'ouvre **jamais** le Plan reste **sans empreinte** (0 colonne Plan, 0 UI charge) — comportement identique aux versions antérieures. Ouvrir le widget Plan crée les colonnes → la charge s'active partout. **Réversible** : remettre une colonne dans `TASKFLOW_SCHEMA` la rend de nouveau toujours créée.

### Charge : `Tasks.charges`

JSON `[{teamId, heures}]` = répartition de l'effort par assigné. `effCharges(t)` = charges réelles, **ou** `estimationH ÷ nb assignés` si l'option **Estimer** est active. `chargeMatrix()` (core) étale ces charges sur la durée de la tâche et agrège par clé/période.

### Modèle Prévu / Réalisé / Reste / Dispo

| Mode | Définition |
|------|------------|
| **Prévu** | charge planifiée (`effCharges`) |
| **Réalisé** | `tempsPasse` réparti ; **à défaut**, pour une tâche **clôturée**, le prévu est repris (= **estimé**, signalé par une légende dédiée) |
| **Reste** | prévu − réalisé (borné à 0) |
| **Dispo** | capacité − charge. **Notion globale** → disponible **uniquement en groupement Personne** (Dispo et Projet/Rôle sont mutuellement exclusifs : choisir Dispo force Personne ; choisir Projet/Rôle en Dispo rétablit Prévu). Une marge par-projet serait surestimée (ignorerait les autres projets de la personne). |

### `dateCloture`

Posée automatiquement au passage en **statut terminal** (`TF.isTerminal`), effacée si réouverture. Pilote le réalisé-sur-clôture et le calcul de **délai**. Écrite par Kanban/Gantt/Calendar (au changement de statut / drag), **seulement si la colonne existe** (opt-in).

---

## Patterns récurrents

### CRUD tâche

```javascript
// CREATE
const id = await grist.docApi.applyUserActions([['AddRecord', 'Tasks', null, {
    titre, description, statut, priorite, type, progression,
    projet: projectId || null,
    dateDebut: dateToGrist(startDate),
    dateEcheance: dateToGrist(endDate),
    assignees: toGristRefList(ids),
    subtasks: subtasksToJson(editData.subtasks)
}]]);

// UPDATE
await grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', parseInt(taskId), taskData]]);

// Mettre à jour couleur d'un membre Team
await grist.docApi.applyUserActions([['UpdateRecord', 'Team', memberId, { couleur: color }]]);
```

### Sous-tâches (FUT-01)

```javascript
// Stockage : JSON string dans Tasks.subtasks
// Format : [{ id: 1, text: "...", done: false }, ...]

const getSubtasks   = (t) => { try { return JSON.parse(t?.subtasks || '[]'); } catch { return []; } };
const subtasksToJson = (arr) => JSON.stringify(arr || []);

function addSubtask()        { /* crée {id: Date.now(), text, done:false}, push, re-render */ }
function toggleSubtask(id)   { /* toggle .done, update editData, re-render */ }
function removeSubtask(id)   { /* filter out, re-render */ }
```

### Export (GEN-03)

Kanban, Calendar et Dashboard uniquement : le Gantt n'expose plus d'export, et ses deux fonctions ont été retirées avec le menu.

```javascript
function exportPrint() { window.print(); }

async function exportPNG() {
    if (!window.html2canvas) {
        // Charge html2canvas depuis CDN dynamiquement
        await new Promise(resolve => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; s.onload = resolve; document.head.appendChild(s); });
    }
    const canvas = await html2canvas(document.querySelector('.main-content'), { backgroundColor: '#f8fafc', scale: 2 });
    const a = document.createElement('a'); a.download = 'export.png'; a.href = canvas.toDataURL(); a.click();
}
```

### Mode démo

```javascript
// Si Grist n'est pas disponible (ouverture locale dans navigateur)
try {
    grist.ready({ requiredAccess: 'full' });
    grist.onRecords(async (data) => { ... });
} catch(e) {
    isDemo = true;
    loadDemoData();  // injecte tasks/team/projects fictifs
}
```

---

## Système de couleurs

Cinq entités colorées, chacune avec une **source unique** et une **règle de lecture** bien définie.

### Entités et sources

| Entité | Stockage | Édition UI (widgets) | Utilisée pour |
|--------|----------|----------------------|---------------|
| `Tasks.couleur` | Grist (`Text`, hex) | Panel tâche → prop-row **Couleur** (`<input type="color">`) | Override individuel d'une tâche |
| `Projects.couleur` | Grist (`Text`, hex) | Panel tâche → **dot projet cliquable** (picker presets) | Identité du projet partout |
| `Team.couleur` | Grist (`Text`, hex) | Panel tâche → **dot membre cliquable** dans assignees (picker presets) | Avatar et barres colorées par assigné |
| `PRIORITY_COLORS` | const JS (hardcodée) | — | Palette standard priorité |
| `STATUS_COLORS` | const JS (hardcodée) | — | Palette standard statut |

### Palette presets partagée

`COLOR_PRESETS` — 10 couleurs harmonisées, déclarée dans chaque widget :
```js
['#3e5de7','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b']
```

Utilisée par les pickers Project/Team. Tasks.couleur utilise un `<input type="color">` natif (spectre complet).

### Hiérarchie de résolution (ordre fixe dans `getTaskColor(t)`)

```
1. task.couleur (si défini)              ← override individuel, priorité absolue
2. colorMode courant :
   ├── 'priority' → PRIORITY_COLORS[getTaskPriority(t)]
   ├── 'project'  → Projects.couleur[t.projet]
   ├── 'assignee' → Team.couleur[premier assigné]
   └── 'status'   → STATUS_COLORS[t.statut]
3. fallback '#94a3b8' (gris neutre)
```

### Mode « Responsable » (Gantt)

`Tasks.Responsable` et `Chantiers.Responsable` désignent un membre des effectifs, dont la couleur
habille la ligne. Le mode n'est proposé que si `TASK_COLS.has('Responsable')`, sinon
`entretenirOptionResponsable()` retire l'option du sélecteur : sans la colonne il n'y a rien à
colorer. À distinguer du mode « Assigné », qui prend le **premier** assigné, là où le responsable est
une donnée unique portée par la ligne.

**C'est le mode par défaut**, en tête du sélecteur, décision du 13/08/2026. À la même date,
`Responsable` n'était renseigné que sur 2 tâches sur 79 et sur aucun chantier : tant que la colonne
n'est pas remplie, la plupart des barres sortent grises. Le garde-fou `entretenirOptionResponsable()`
rend la main au mode projet sur un document qui n'a pas la colonne du tout.

### Relecture au retour sur le widget (Gantt)

`grist.onRecords` ne notifie que la table du widget, `Tasks`. Une modification dans `Team`, `Projects`
ou `Chantiers` passe donc inaperçue : couleurs et libellés restent périmés jusqu'à un rechargement de
la page. Cas concret rencontré : changer la couleur d'un membre ne changeait pas les barres colorées
par responsable.

Le Gantt relit donc l'ensemble quand il **reprend la main** (`focus`, ou `visibilitychange` qui
redevient visible), ce qui couvre le geste réel : aller modifier la table, puis revenir. Le drapeau
`mainPerdue` évite une seconde lecture à l'ouverture, où un `focus` arrive sans qu'on ait rien perdu,
et la relecture est sautée pendant un geste souris.

**Limite connue** : si Grist ne redonne pas le focus à l'iframe au retour sur la page, il faut un clic
dans le widget. Un changement d'onglet du navigateur, lui, est couvert par `visibilitychange`.

### Mode "Colorer par" / tri — persistance locale (sauf Gantt)

Pour **Kanban et Calendar**, `colorMode` et `sortMode` sont stockés en `localStorage` par widget (clés `taskflow_<widget>_colormode`, `taskflow_<widget>_sort`), sans `grist.setOption` (Grist marque sinon le document comme modifié à chaque changement de préférence UI).

**Gantt : pas de persistance.** `colorMode`, `sortMode` et `currentView` vivent uniquement en mémoire, réinitialisés à leurs défauts (`project` / `date` / `semester`) à chaque chargement, conservés le temps de la session, remis à zéro à la réouverture. Décision issue des tests : les défauts doivent toujours revenir à l'ouverture.

**Les filtres** (`filters.project`, `filters.priority`, `filters.assignee`) continuent d'utiliser `grist.setOption` (partagés inter-widgets) — c'est le comportement attendu pour un filtre collaboratif.

### Application par widget

| Widget | Élément coloré par `getTaskColor(t)` | Couleur projet dot |
|--------|--------------------------------------|---------------------|
| **Gantt** | Barres (`bar.style.background = getTaskBarGradient(t)`) + diamant jalon | Inchangée (dot panel cliquable) |
| **Kanban** | Bordure gauche des cartes (`border-left-color`) | Inchangée (dot panel cliquable) + dot `●` dans card-meta |
| **Calendar** | Gradient des barres `event-bar` / `week-event-bar` (hors jalon) | Inchangée (dot panel cliquable) + border-left-color des barres |

### Fonctions standards

Présentes dans chaque widget, identiques :
```js
function getTaskColor(t) { /* hiérarchie ci-dessus */ }
function getTaskBarGradient(t) { return 'linear-gradient(135deg, ' + c + ', color-mix(in srgb, ' + c + ' 70%, white))'; }
async function setProjectColor(projectId, color) { /* UpdateRecord Projects.couleur */ }
async function setMemberColor(memberId, color) { /* UpdateRecord Team.couleur */ }
function changeColorMode(mode) { /* met à jour colorMode + re-render (Gantt : en mémoire) */ }
```

### Repère de version (Gantt)

Le widget porte la constante `VERSION_SERVIE = '__VERSION_TASKFLOW__'`. Le marqueur est remplacé
**à la construction du site** par `pages.yml` : le tag de la dernière release à la racine, la sortie
de `git describe --tags` pour la nightly, par exemple `v1.19.2-12-gbfa201d`. Sur une copie locale, il
n'est jamais remplacé, et le badge affiche `local`.

L'affichage est réservé à qui l'active : `localStorage.taskflow_show_version = "true"`. Il sert à
voir d'un coup d'œil quelle version est réellement servie, le cache de GitHub Pages pouvant faire
croire à un déploiement absent.

**Ne pas remplacer le marqueur ailleurs qu'au déploiement** : le mettre dans le dépôt ferait
diverger `projects/` et `published/` à chaque release.

### Volet tâche (Gantt)

L'ordre des blocs est fixé par le document « UI du volet tâche » : Description, Dates, Statut,
Progression, Responsable, Contributeurs, Projet, Chantier, Priorité, Sous-tâches, Parent,
Dépendances, Tags, Temps et charge. Il est écrit **dans le gabarit**, `groupeDeProps()` posant les
lignes de propriétés par paquets et n'émettant rien quand toutes sont masquées.

**Ne pas réintroduire d'ordre CSS** (`order:` sur `.pr-status`, `.pr-prog` ou équivalent) : deux
règles de ce genre contredisaient l'ordre du gabarit à l'écran, et un test qui lisait l'ordre du DOM
passait au vert malgré tout. Les tests d'ordre mesurent donc la position **affichée**.

`Responsable` est facultative comme les colonnes du Plan : sans elle, la ligne disparaît du volet et
le mode de couleur correspondant quitte le sélecteur. Le rattachement au chantier s'édite depuis la
fiche et passe par la colonne réelle, cf la détection par type plus bas.

### Bandeau de projet (Gantt)

Le bandeau qui ouvre chaque groupe de projet porte la couleur de son **responsable**
(`Projects.responsable` → sa couleur d'équipe), en fond translucide à 20 %. Sans responsable, ou
lorsque celui-ci n'a pas de couleur, la couleur du projet reprend la main : sans ce second test,
`getTeamMemberColor()` renverrait son bleu par défaut et tous les bandeaux se ressembleraient.

Il se prolonge sur la timeline (`.grid-row.piste-groupe`), même teinte et même hauteur, collé en
haut comme son pendant de gauche puisque les deux colonnes défilent de concert. Le trait qui
séparait le bandeau de sa première ligne a été retiré, la teinte suffit à marquer la rupture.

### Légende (Gantt uniquement)

Dynamique selon `colorMode` — rendue par `renderLegend()` appelée dans `render()`. Affiche les 4 priorités, ou les statuts, ou les 8 premiers projets/membres actifs selon le mode.

### Bonnes pratiques

- **Ne jamais** hardcoder une couleur de barre/carte — toujours via `getTaskColor(t)`
- **Ne jamais** écrire dans `Tasks.couleur`, `Projects.couleur`, `Team.couleur` sans passer par les helpers `updateField`, `setProjectColor`, `setMemberColor` (qui synchronisent local + Grist)
- Les **classes CSS `.p1-.p4`** restent pour fallback mais sont surchargées par les styles inline
- **Jalons** (type=`jalon`) : leur background reste transparent dans Calendar/Gantt ; seul le diamant reçoit `getTaskColor()`

---

## Hiérarchie WBS (sous-tâches structurelles)

Trois concepts **orthogonaux** coexistent dans TaskFlow, chacun avec son usage :

| Concept | Colonne | Stockage | Rôle | Éditable |
|---------|---------|----------|------|----------|
| **Checklist** | `subtasks` | Text JSON `[{id,text,done}]` | Puces cochables rapides dans le panel | Tous widgets |
| **Dépendance** | `dependDe` | RefList:Tasks | A attend la fin de B (temporel) | Tous widgets |
| **Décomposition** (WBS) | `parentTask` | Ref:Tasks | A **contient** B, C, D (hiérarchie) | Via panel (Phase 2+) |

**Important** : une sous-tâche WBS est une **vraie tâche Grist** avec ses propres dates, assignés, priorité, progression, checklist, dépendances. Le parent est une tâche comme les autres qui a simplement des enfants.

### Invariants

- `parentTask = null` → racine (comportement hérité)
- `parentTask` ne peut jamais créer un cycle (`canSetParent(id, newParent)` valide)
- Un enfant peut avoir un statut/projet/priorité **différent** de son parent (aucune règle de cohérence forcée)
- Suppression parent : cascade (défaut) ou détachement (enfants deviennent racines) — choix au moment de la suppression

### API commune (dans chaque widget)

```js
// Cache des enfants par parent, reconstruit à chaque loadAllData()
let childrenByParent = new Map();
function rebuildChildrenCache() { /* ... */ }

// Helpers structure
isRoot(t), getParent(t), getChildren(id), hasChildren(t), getDepth(t)
walkTree(roots, cb)          // DFS itératif pré-ordre avec depth
getAllDescendants(id)
canSetParent(id, newParent)  // anti-cycle

// Agrégations — calculées à la demande, JAMAIS persistées
aggregateProgress(t)  // moyenne pondérée par estimationH si toutes en ont
aggregateDates(t)     // min(starts descendants), max(ends descendants)
```

### Règles d'agrégation

| Métrique | Règle si `hasChildren(t)` |
|----------|---------------------------|
| Progression | **Auto-calculée** (moyenne pondérée par `estimationH` si dispo, sinon simple) — jamais persistée |
| Dates | **Stockées explicitement** (l'utilisateur peut vouloir réserver une plage plus large que les enfants) — bouton "Ajuster aux bornes des sous-tâches" à venir |
| Assignés | **Pas d'agrégation** — le parent peut avoir son propriétaire distinct |

### Schéma (additif, rétrocompatible)

Colonne ajoutée dans `TASKFLOW_SCHEMA.Tasks` (Kanban, Gantt, Calendar) :
```js
{ id: 'parentTask', type: 'Ref:Tasks' }
```

`ensureSchema()` l'ajoute automatiquement à la prochaine ouverture d'un doc existant. Les tâches existantes ont `parentTask = null` → racines → comportement inchangé.

### Exemple hiérarchique dans seedData + useDemoMode

Chaque widget crée "Dev Backend" / "API backend" avec 3 sous-tâches :
- "Modèle de données" (done)
- "Routes API" ou "Routes /users /auth" (en cours)
- "Tests unitaires" (à faire)

Découvrabilité de la feature dès la première ouverture.

---

## Backlog forum (prochaines évolutions)

Demandes remontées sur le forum Grist community :

| Priorité | Demande | Complexité |
|----------|---------|------------|
| 🔴 | Vue multi-projets compacte Gantt (1 ligne/projet, tâches en cascade) | ⭐⭐⭐ |
| 🟡 | Tâches colorées par catégorie/tag | ⭐⭐ |
| 🟡 | GristDocTour (visite guidée du document exemple) | ⭐⭐ |
| 🟢 | Dépendances avec recalcul automatique des dates (chemin critique) | ⭐⭐⭐⭐ |
| 🟢 | Configuration colonnes/tables dans le widget (mapping custom) | ⭐⭐⭐ |

---

## Points d'attention

### Pièges fréquents

1. **Dates** : Grist stocke en secondes Unix, JS en millisecondes → toujours `* 1000` / `/ 1000`
2. **RefList** : format `['L', id1, id2]` — ne jamais passer un tableau nu
3. **`setOptions` ↔ `onOptions`** : appeler `setOptions` déclenche `onOptions` dans le même widget → utiliser le flag `_saving` pour éviter la boucle
4. **broadcastFilters** : ne PAS appeler depuis le Dashboard (filtres locaux seulement)
5. **Kanban = widget maître** : c'est lui qui initialise le schéma — toujours le charger en premier dans un nouveau document
6. **Gantt : `render()` est différé pendant un geste souris** : voir ci-dessous, ne pas retirer la garde

### Repli sur les données d'exemple : absence de Grist, jamais lenteur

Chaque widget pose à l'init un filet qui bascule sur `useDemoMode()` / `loadDemo()` au bout de
2.8s (2.5s pour le Plan), pour l'aperçu hors Grist. Sa condition est **`!gristPresent`** : le
handshake `grist.ready()` n'a pas abouti, donc il n'y a pas de Grist en face.

**Ne pas** le rebrancher sur « les données sont vides ». Sur un poste modeste ou un réseau
lent, les lectures de tables dépassent le délai alors que Grist est bien là : le widget
remplaçait alors les données réelles par celles de la démo. Sur le Plan, `S.demo` conditionne
en plus **toutes** les écritures (charges, replanification, capacité, disponibilités) : une
fois posé, l'utilisateur modifiait sans que rien ne soit enregistré, et sans aucun signal.

`gristPresent` (handshake abouti) est distinct de `gristReady` (chargement terminé, écritures
autorisées) : le premier est posé juste après `grist.ready()`, le second en fin de
`loadAllData()`. Les confondre ramène le bug.

Couvert par `tests/e2e/repli-demo.spec.js`, qui exerce les deux cas sur les cinq widgets :
lectures lentes avec Grist présent (pas de démo) et handshake sans réponse (démo).

Le Plan journalise son ouverture en console sous le préfixe `[plan]` : handshake, durée et
volume de chaque lecture, création de colonnes, repli, puis rendu avec ce qui a été dessiné.
Une anomalie sort en `warn`, un blocage en `error`, le reste en `log` — de quoi diagnostiquer
un poste sur une simple capture d'écran. Couvert par `tests/e2e/plan-journal.spec.js`.

### Lecture qui ne répond jamais

Une lecture qui ne résout ni n'échoue laissait le widget sur « Chargement… » indéfiniment :
`loadGrist()` attend un `Promise.all` sur les quatre tables, `render()` n'était jamais atteint,
et le filet du handshake ne s'applique pas — à raison, Grist a répondu. Le journal s'arrêtait
sur les tables qui avaient répondu, sans jamais nommer celle qui manquait : le symptôme
« parfois rien ne se charge » n'était donc pas diagnosticable, même avec la console sous les yeux.

`_lecturesEnAttente` tient les lectures en vol par nom de table. Au bout de
`DELAI_SANS_REPONSE` (10s), `signalerAttente()` les nomme en `warn` et remplace
« Chargement… » par un message qui les liste. Le délai est large exprès : une lecture lente
finit par aboutir, et le message est alors remplacé par le rendu.

**Ne pas** basculer sur les données d'exemple dans ce cas : les lectures peuvent encore
aboutir, et la démo couperait les écritures sans le dire — c'est le bug corrigé juste au-dessus.
Ne pas raccourcir le délai jusqu'à croiser les lectures lentes légitimes.

### Remonter dans le passé (Gantt)

Règle posée en revue le 14/08/2026 : dans chaque vue, la timeline doit pouvoir remonter jusqu'au
début de la tâche affichable la plus ancienne. `computeTimelineScale()` recule donc sa borne gauche
sur **toutes** les tâches, y compris celles entièrement antérieures à la fenêtre, alors qu'elle les
ignorait auparavant. La borne droite, elle, ne suit que les tâches qui touchent la fenêtre : une
échéance lointaine n'a pas à étirer la vue courante.

L'option `extendLeft`, qui figeait la borne gauche des vues glissantes (trimestre, semestre), ne
s'applique plus à ce recul. C'était la cause du symptôme : le passé restait inatteignable au
défilement dans ces deux vues, alors que la vue année y donnait accès.

**Coût mesuré**, sur 132 lignes étalées sur quatre ans, à comparer aux quelque 900 cellules d'une
fenêtre seule :

| Vue | Cellules de grille | Rendu |
|---|---|---|
| Semaine | 83 000 | 200 ms |
| Semestre | 15 200 | 45 ms |
| Année | 3 600 | 21 ms |

**Cette piste a été suivie le 04/09/2026** : le quadrillage, les week-ends et la colonne du jour
sont des couches de fond de `#timelineGrid`, posées par `peindreFondGrille()`. L'ordre des couches
reproduit celui des bordures d'origine, le quadrillage passant au-dessus du reste. Seuls les
séparateurs de début de mois restent des éléments, les mois n'ayant pas tous la même longueur, à
raison d'un par mois de la plage et non d'un par jour et par ligne.

Mesuré sur l'export du document de production, 344 tâches et 132 chantiers étalés sur 6,6 ans :

| Vue | Nœuds avant | Nœuds après | Rendu avant | Rendu après |
|---|---|---|---|---|
| Semaine | 834 967 | 7 710 | 2 035 ms | 56 ms |
| Mois | 834 967 | 7 710 | 3 478 ms | 65 ms |
| Trimestre | 123 047 | 4 350 | 1 638 ms | 48 ms |
| Semestre | 123 268 | 4 352 | 466 ms | 36 ms |
| Année | 31 528 | 3 935 | 303 ms | 34 ms |

Un dépliage passe de 139 ms en moyenne à 16 ms, et le tas de 38 Mo à 10 Mo. Le rendu est identique
au pixel près, vérifié par comparaison de captures avant et après.

**Ne pas** réintroduire d'élément par colonne : `tests/e2e/gantt-timeline.spec.js` vérifie qu'aucun
élément ne vit dans une `.grid-row` sur une plage étirée par une tâche ancienne.

### Chantiers dans leur propre table (Gantt)

Les chantiers quittent `Tasks` pour une table `Chantiers`. Cible arrêtée avec le métier :

```
Projet / Produit / Offre de service  >  Chantier  >  Tache  >  Sous-tache
```

Un chantier peut être rattaché à plusieurs projets (`Chantiers.Projets` en RefList), une tâche à un
seul chantier, et une tâche n'a qu'un seul parent.

Le Gantt lit les deux modèles, en se fiant au **type déclaré** des colonnes (`typeColonne()`, sur les
métadonnées déjà chargées dans `schemaMeta`) et jamais aux valeurs :

| Lien | Colonne |
|------|---------|
| tâche vers son chantier | `Tasks.chantier`, sinon `Tasks.parentTask` si son type désigne `Chantiers` |
| tâche vers sa tâche parente | `Tasks.parentTask`, **uniquement** si son type désigne `Tasks` |

**Pourquoi le type et pas la valeur.** Les identifiants de `Chantiers` et de `Tasks` se recouvrent : sur
la copie de travail du métier, résoudre `parentTask` dans `Tasks` rattachait 41 tâches sur 79 à une
autre tâche sans rapport, et créait 15 chaînes cycliques. Sans plantage, grâce aux gardes anti-cycle,
mais avec une hiérarchie fausse.

`fusionnerChantiers()` insère les chantiers comme lignes de niveau 0, décalés de `ID_CHANTIER` pour
cohabiter avec les tâches dans un même tableau, et fait hériter le projet du chantier aux tâches qui
n'en portent pas. Les lignes chantier sont marquées `estChantier` : le volet tâche ne s'ouvre pas
dessus et elles ne sont ni déplaçables ni redimensionnables, tant que le volet chantier n'existe pas.
L'écriture de la colonne d'affichage de `parentTask` est également conditionnée à son type.

La colonne de rattachement se reconnaît **au seul type `Ref:Chantiers`**, son nom appartenant à qui
tient la structure du document : sur le document du métier elle s'appelle `Chantiers`, et deux noms
en dur (`chantier`, `parentTask`) laissaient les 79 tâches sans chantier, donc sans projet hérité,
donc toutes sous « Sans projet ». Le code manipule ensuite le rattachement sous le nom `chantier` :
`pruneTaskRecord()` le retraduit vers la colonne réelle avant d'élaguer, sans quoi l'écriture
partirait sans rattachement et sans le dire. Le contrat de données est décrit dans le README.

**Ne pas** rattacher une ligne chantier par son identifiant brut, ni écrire dans `Tasks` depuis une
ligne chantier : son identifiant décalé ne correspond à aucun enregistrement.

Couvert par `tests/e2e/gantt-chantiers.spec.js`, qui exerce les trois états du document : modèle cible,
copie de travail où `parentTask` a été repointé, et ancien modèle sans table `Chantiers`.

#### Chantiers vus par le Plan

Le plan de charge n'est pas un arbre : il ne fait pas remonter les chantiers en lignes. Il les lit
pour deux choses, avec les mêmes règles de détection fondées sur le type déclaré des colonnes.

`projetDeTache()` rend le projet de la tâche, ou à défaut celui de son chantier (`Chantiers.Projets`,
premier de la liste). Sans cela, le groupement par projet et les libellés du drill s'effondrent sur un
seul « Sans projet » : sur le document du métier, aucune des 79 tâches ne renseigne `Tasks.projet`,
le rattachement vit sur le chantier.

Le groupement **Chantier** s'ajoute à Projet et Rôle, sur le même modèle hiérarchique (en-tête de
groupe, sous-ligne par personne chargée). Son option est retirée du sélecteur par
`entretenirOptionChantier()` sur un document sans chantiers.

`projetDeTache()` est une **lecture seule** : le projet déduit ne doit jamais repartir en base, il
écrirait un rattachement que le métier n'a pas saisi. Le Plan n'écrit que `Tasks.charges`,
`Tasks.assignees`, les dates, `Team.capaciteHebdo` et `Disponibilites` : aucune colonne dont le sens
a changé.

Couvert par `tests/e2e/plan-chantiers.spec.js`, sur les trois mêmes états de document que le Gantt.

#### Volet chantier

Le volet est **le même** pour une tâche et pour un chantier : `panelState.estChantier` porte la
distinction, et `adapterVoletChantier()` retire après rendu ce que le cadrage masque (priorité,
progression, parent, couleur, planning, checklist), renomme les sous-tâches en « Tâches » et le bouton
en « Ajouter une tâche ». Adapter après rendu évite de dupliquer la construction du volet, qui fait
plusieurs centaines de lignes ; en contrepartie ce retrait s'appuie sur les libellés affichés.

Les prérequis sont retirés aussi : le cadrage ne les mentionne pas et `Chantiers.Depend_de` n'est pas
typé, donc les laisser ouvrirait une écriture sans destination.

`donneesChantier()` prépare les données du volet : les dates absentes sont préremplies depuis les
tâches tout en restant modifiables, les assignés et les charges sont des **remontées** des tâches.
`saveChantierToGrist()` écrit dans `Chantiers` (`Nom_du_chantier`, `Description` et les deux dates),
en retranchant `ID_CHANTIER` de l'identifiant affiché.

Les **dates d'un chantier** ne portent pas le même nom partout : le document du métier les appelle
`Debut` et `Fin`, le modèle de référence `Date_debut` et `Date_fin`. `colonneDateChantier()` retient
la première qui existe et qui est bien de type `Date`, comme `colonneChantier()` le fait pour le
rattachement. Écrire un nom en dur revenait à faire élaguer les deux colonnes par
`pruneChantierRecord()` : aucune date de chantier ne partait en base, et la lecture retombait sur les
bornes des tâches, ce qui masquait la panne à l'affichage.

> `Chantiers.Contributeurs` n'est ni écrite ni lue. La colonne existe dans la structure du document,
> mais un chantier ne tient pas sa propre liste : elle remonte de ses tâches, dans le volet **comme
> sur les pastilles de la ligne**. Les lire de deux sources différentes montrait des têtes à gauche
> en face d'un volet vide. Le volet n'affiche donc que la
> remontée des tâches : l'écrire remplaçait la saisie faite dans Grist à chaque enregistrement, et la
> vidait sur un chantier sans tâche. Le bloc porte la mention « Remontée automatique des contributeurs
> aux tâches », arbitrage du 27/08/2026 : sans elle, un chantier dont les tâches n'ont personne montre
> un bloc vide qui passe pour une panne.

#### Création

Le bouton « + Chantier » n'apparaît que si le document a la table (`colonneChantier()`), et
`createChantier()` fait l'`AddRecord`. Deux boutons distincts plutôt qu'un menu : c'est ce que montre
la maquette, là où le texte du cadrage parle d'un bouton « Ajouter » générique.

Une tâche créée depuis un chantier reçoit `chantier`, pas `parentTask` : le niveau 0 est réservé aux
chantiers. `pruneTaskRecord()` ne retire `parentTask` que lorsqu'il vaut un identifiant décalé, sans
quoi il deviendrait impossible de créer une sous-tâche.

### Deux types de lien entre tâches (Gantt)

Une tâche peut en suivre une autre de deux façons : commencer **après sa fin** (fin→début, le modèle
historique) ou **en même temps qu'elle** (début→début). Chaque type a sa colonne, `Tasks.dependDe` et
`Tasks.dependDebutDe`, toutes deux `RefList:Tasks`.

**Pourquoi deux colonnes plutôt qu'un type porté à côté d'une liste unique.** Une liste typée
demanderait un JSON, illisible dans Grist et à migrer depuis l'existant. Deux RefList restent lisibles
et modifiables directement dans le document, et l'ajout est purement additif.

`dependDebutDe` est **opt-in** : la structure du document appartient au métier, aucun widget ne crée
la colonne. Sans elle, `depDebutDisponible()` est faux, la seconde liste disparaît du volet,
`pruneTaskRecord()` retire la clé des écritures, et rien n'est tracé. Le Gantt fonctionne comme avant.

Ce que les deux types partagent et ce qui les sépare :

| | fin→début | début→début |
|---|---|---|
| Contrainte sur le successeur | commence le lendemain de la fin du prédécesseur | commence au plus tôt au début du prédécesseur |
| Origine de la flèche | fin de la barre du prédécesseur | son début |
| Trait | tirets `4 2` | pointillé `1 3` (`.depart-debut`) |
| Volet, liste amont | « Commence après la fin de » | « Commence en même temps que » |
| Volet, liste aval | « → Bloque : » | « → Démarre avec : » |
| Prérequis d'un jalon | oui | non, un démarrage conjoint n'est pas un préalable |

Les deux comptent pour la **détection de cycle** (`getAllPredecessors`) : un cycle se forme aussi bien
en mélangeant les deux types qu'avec un seul. `propagateDependencyDates()` calcule une date minimale
par lien, puis ne garde qu'un report par tâche : une tâche liée deux fois au même prédécesseur serait
sinon comptée deux fois dans le message de fin de déplacement.

Couvert par `tests/e2e/gantt-dependances.spec.js`.

### Écritures vers une table dont la structure ne nous appartient pas

Grist rejette **le lot entier** dès qu'une action vise une colonne absente ou calculée. Une seule
colonne en trop et rien n'est enregistré, sans autre indice qu'un refus.

`pruneTaskRecord()` élaguait déjà les écritures de `Tasks` sur les colonnes réellement présentes ;
`colonnesEcrivables(tableId)` y ajoute le filtre des colonnes calculées, que la lecture rend pourtant
comme les autres. `pruneChantierRecord()` applique le même traitement à `Chantiers`, table que le
widget ne crée pas et dont il ne choisit pas la structure.

C'est ce qui manquait à la création de chantier : elle posait `Projets`, seule colonne que
l'enregistrement n'écrit pas, et cassait donc là où la modification passait. Les refus font désormais
remonter leur raison dans le toast et la console, sans quoi l'échec ne se diagnostique pas.

Couvert par `tests/e2e/gantt-chantiers.spec.js`, sur un document dont une colonne est calculée.

### Gantt : report du rendu pendant un geste souris

`render()` (gantt.html) commence par une garde :

```js
if (gesteSourisEnCours) { renduEnAttente = true; return; }
```

**Pourquoi.** `render()` reconstruit `#taskList` et `#timelineGrid` par `innerHTML`. Le navigateur
n'émet un `click` que si le `mousedown` et le `mouseup` partagent un ancêtre commun encore attaché
au document. Si un rendu survient entre les deux, la ligne ou la barre visée est arrachée et
**aucun `click` n'est émis**. Le clic est silencieusement perdu, l'utilisateur doit recommencer.

**Deux chemins déclenchent ce cas :**

- une saisie dans le titre ou la description, dont le `blur` provoque une écriture Grist, donc
  `onRecords`, donc `loadAllData()` puis `render()` ;
- tout clic sur une barre, `startDrag` et `endDrag` s'exécutant même sans déplacement et
  appelant `render()`.

**Le mécanisme.** Deux écouteurs posés en phase de **capture**, pour s'armer avant le
`stopPropagation()` que `startDrag` pose sur le `mousedown` d'une barre ou d'une poignée. Le
désarmement au `mouseup` est repoussé d'un tour de boucle par `setTimeout(..., 0)`, afin que le
`click` du navigateur parte sur une cible encore attachée. Deux filets, sur `blur` de la fenêtre
et `mouseleave` du document, évitent de rester bloqué si le relâchement n'arrive jamais dans la
page. Si plusieurs rendus sont demandés pendant un même geste, ils sont fusionnés : seul
`renduEnAttente` compte, pas leur nombre, donc une seule reconstruction est jouée au désarmement.

**Un troisième chemin, sans `mouseup` du tout.** Le glisser natif HTML5 (Sortable.js,
réordonnancement manuel de la liste des tâches, ou tout glisser de texte déjà sélectionné hors
du champ titre) émet `mousedown`, `dragstart`, `drop`, `dragend` : jamais `mouseup`, le
navigateur ne l'émet pas dans ce cas. Sans désarmement dédié, `gesteSourisEnCours` restait armé
indéfiniment : le rendu d'annulation d'un déplacement hors fratrie ne s'exécutait pas (le
déplacement interdit restait affiché), et toute mise à jour entrante (`onRecords`, changement de
vue, filtres) restait sans effet jusqu'au clic suivant. `dragend` et `drop` sont donc ajoutés
aux événements qui désarment le geste, via `terminerGesteSouris`, en phase de capture et sans le
tour de boucle du `mouseup` : aucun `click` ne suit un glisser natif, il n'y a rien à laisser
partir sur une cible encore attachée.

**Ne pas.** Supprimer la garde de `render()`, déplacer les écouteurs en phase de bulle, retirer le
`setTimeout` du `mouseup`, ou brancher la sélection des lignes sur `mousedown` pour contourner le
problème. Chacun de ces changements ramène le clic perdu.

Couvert par `tests/e2e/bascule-geste-reel.spec.js`, avec des gestes souris et clavier réels, y
compris le glisser natif sans `mouseup`. Ces tests échouent si la garde ou le désarmement sont
retirés. `tests/e2e/interaction.spec.js` couvre le panneau lui-même mais n'exerce pas ce
mécanisme : il reste entièrement vert dans ce cas.

### Déploiement

```
projects/tasks_app/kanban.html     →  published/taskflow/kanban/index.html
projects/tasks_app/gantt.html      →  published/taskflow/gantt/index.html
projects/tasks_app/calendar.html   →  published/taskflow/calendar/index.html
projects/tasks_app/dashboard.html  →  published/taskflow/dashboard/index.html
projects/tasks_app/plan.html       →  published/taskflow/plan/index.html
```

Avant copie : `npm run build:inline` puis `npm run check:inline`. Après copie : `npm run manifest` pour régénérer `published/manifest.json`.

URLs publiées : `https://nic01asfr.github.io/Widgets-Grist/taskflow/{widget}/`
