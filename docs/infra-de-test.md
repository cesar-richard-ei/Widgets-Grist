# Infrastructure de test et trajectoire d'assainissement

## Contexte

Les widgets sont des fichiers HTML autonomes de 100 à 230 Ko, tout inline, sans aucun test.
`gantt.html` fait 3164 lignes dont un seul scope global, des gestionnaires en attributs `onclick`
et un panneau latéral reconstruit par concaténation de chaînes.

Le seul code déjà factorisé est `projects/tasks_app/core/taskflow-core.js` (323 lignes,
17 fonctions exportées), inliné dans 6 widgets par `scripts/build-taskflow.js` entre les
marqueurs `// <taskflow-core>` et `// </taskflow-core>`.

Les widgets sont intégrés par « Custom URL » sur une instance Grist SecNumCloud
(`grist.numerique.gouv.fr`) que nous n'administrons pas. Le catalogue `manifest.json` n'y est
donc pas exploitable, la variable `GRIST_WIDGET_LIST_URL` n'étant pas accessible.

Le dépôt est un fork divergent : aucune synchronisation avec l'amont n'est prévue.

## Objectifs

- Pouvoir vérifier un correctif sans instance Grist ni document de test.
- Attraper les régressions sur le core, inliné dans 6 widgets, où un bug se propage partout.
- Disposer d'une mesure de performance reproductible.
- Faire converger la structure vers des unités testables, sans refonte préalable.

## Non-objectifs

- Remplacer la vérification sur l'instance réelle avant publication.
- Introduire un bundler ou un framework.
- Restructurer le dépôt avant que le travail ne l'exige.

## Le faux Grist

`tests/fake-grist.js`. Objet injecté dans la page avant chargement, adossé à un document en
mémoire. Le widget ne sait pas qu'il est testé.

### Surface à couvrir

Relevé sur les 6 widgets.

| Méthode | Appels | Comportement attendu |
|---------|--------|----------------------|
| `docApi.applyUserActions` | 79 | Applique les actions au document et les journalise |
| `docApi.fetchTable` | 71 | Rend le format colonnaire `{ id: [...], col: [...] }` |
| `ready` | 12 | Enregistre les options, déclenche l'émission initiale |
| `setSelectedRows` | 7 | Journalise |
| `setOption` | 7 | Écrit dans les options du widget, notifie `onOptions` |
| `onRecords` | 6 | Rappel sur la table liée, réémis après mutation |
| `onOptions` | 6 | Rappel sur changement d'options |
| `onRecord` | 5 | Rappel sur changement de sélection |
| `docApi.listTables` | 3 | Liste des tables du document |
| `setCursorPos` | 2 | Journalise |
| `widgetApi.getOptions` | 1 | Lecture des options |

### Actions utilisateur à implémenter

`AddRecord` (44), `UpdateRecord` (34), `AddColumn` (15), `ModifyColumn` (8),
`SetDisplayFormula` (7), `RemoveRecord` (6), `AddTable` (6), `BulkAddRecord` (1).

`AddColumn`, `ModifyColumn` et `SetDisplayFormula` sont indispensables : `ensureSchema()` s'en
sert à chaque ouverture de widget. Sans elles, aucun widget ne démarre.

### Tables de métadonnées

Les widgets lisent `_grist_Tables` (12 fois) et `_grist_Tables_column` (18 fois) pour découvrir
le schéma réel et les choix de la colonne `statut`. Le simulacre doit donc maintenir ces deux
tables en cohérence avec les tables applicatives : toute action de schéma s'y répercute.

Tables applicatives rencontrées : `Tasks`, `Team`, `Projects`, `Disponibilites`.

### Propriétés

- **Format colonnaire fidèle**, pour que la conversion soit réellement exercée.
- **Application réelle des actions**, permettant d'assertir sur l'état obtenu.
- **Journal des actions**, permettant d'assertir sur ce qui a été émis, indépendamment de l'état.
- **Réémission de `onRecords` après mutation**, comme le vrai Grist, pour exposer les bugs de
  réactivité.

### Limites assumées

Un simulacre diverge du produit réel. Le Whiteboard documente déjà un cas
(`projects/whiteboard/index.html`, lignes 1463 et 2122) : sur `grist.numerique.gouv.fr`,
`ModifyColumn` sur une colonne `Ref` déclenche trois actions internes.

Le simulacre reste donc volontairement minimal et les divergences constatées sont consignées
dans ce document au fur et à mesure. Il ne dispense pas d'un passage sur l'instance avant
publication.

### Registre des divergences

| Sujet | État |
|-------|------|
| `ModifyColumn` sur une colonne `Ref` | Déclenche trois actions internes sur l'instance réelle, une seule dans le simulacre. Relevé dans `projects/whiteboard/index.html`, lignes 1463 et 2122. |
| Second argument de `onOptions` | Implémenté en `{ source: 'self' }`, **déduit** de la garde `interaction?.source !== 'self'` présente à l'identique dans le Gantt, le Kanban et le Calendar. Non vérifié contre l'API réelle. À confronter à l'instance en phase 1. |
| Instance unique | Le simulacre ne modélise qu'un widget. Il ne peut donc pas produire une notification `onOptions` venue d'un autre widget, donc pas exercer la branche « notification externe » de la garde anti-boucle. |
| Compteurs de références internes | `prochainRefTable` et `prochainRefColonne` ne sont pas couverts par l'instantané transactionnel. Après restauration d'un lot échoué, la numérotation des métadonnées présente un trou. Sans collision ni effet fonctionnel. |

## Niveaux de test

### Niveau 1, unitaire sur le core

Runner `node:test`, intégré à Node 20, déjà la version utilisée par la CI. Aucune dépendance.

Une ligne ajoutée en fin de `core/taskflow-core.js` :

```js
if (typeof module !== 'undefined' && module.exports) module.exports = TF;
```

Inerte dans le navigateur, où `module` n'existe pas. Le code inliné dans les widgets n'est pas
affecté.

Couvre les fonctions pures : `columnarToRows`, `buildStatusConfig`, `getStatus`, `isTerminal`,
`parseCharges`, `chargesToJson`, `chargeTotal`, `chargeByMember`, `periodKey`,
`chargeByMemberPeriod`, `shiftPeriods`, `periodRange`, `chargeMatrix`.

Les trois fonctions couplées à Grist (`loadStatusConfig`, `seedStatusChoices`,
`setRefDisplayColumns`) sont testées avec le simulacre.

### Niveau 2, widget complet

`@playwright/test`, Chromium réel, simulacre injecté par `addInitScript` avant chargement de la
page.

jsdom a été écarté faute de moteur de rendu. Les correctifs attendus portent sur un calque qui
intercepte les clics (#4, #11), sur de l'interface (#10) et sur une mesure de temps (#5). jsdom
ne peut en valider aucun. Un test qui passe sans rien prouver est plus nuisible qu'absent.

Coût : une dépendance de développement et le téléchargement d'un navigateur.

### Niveau 3, performance

Même outil. Jeux de données générés dans le simulacre à 50, 200, 500 et 2000 tâches, avec
hiérarchie et dépendances, mesure du temps d'ouverture du Gantt à chaque palier. Répond au
ticket #5, pour lequel aucun ordre de grandeur n'est disponible, et établit le seuil de
non-régression une fois le volume réel connu.

### Commandes

```
npm test           niveau 1
npm run test:e2e   niveaux 2 et 3
```

Deux runners plutôt qu'un. Unifier sous Vitest ajouterait une dépendance et une configuration
pour n'économiser qu'une commande.

## Structure

Ajouté en phase initiale, sans toucher au code de production :

```
tests/
  fake-grist.js
  fixtures/
  unit/core.test.js
  e2e/
    gantt-panel.spec.js
    gantt-filters.spec.js
    perf.spec.js
```

Cible de modularisation, atteinte progressivement :

```
projects/tasks_app/
  src/
    core/taskflow-core.js
    gantt/
      panel.js
      timeline.js
      filters.js
  gantt.html      gabarit a marqueurs
```

`build-taskflow.js` ne connaît aujourd'hui qu'un marqueur. Il est étendu pour accepter des
marqueurs nommés, de sorte que n'importe quel module soit inlinable. Le mécanisme est déjà
idempotent et dispose d'un mode `--check`. Aucun bundler n'est introduit.

Le livrable reste un fichier HTML autonome : sur une instance non administrée, un widget sans
chemin relatif à résoudre ni ressource externe à charger ne peut pas être cassé par
l'hébergement ou par une politique de sécurité.

## Intégration continue

Le workflow existant est étendu d'un job de test exécutant les deux niveaux, ainsi que
`build:taskflow --check`, qui existe déjà mais que rien ne déclenche aujourd'hui. Une
désynchronisation entre le core et les widgets inlinés passerait actuellement inaperçue.

## Trajectoire

| Phase | Contenu | Code de production |
|-------|---------|--------------------|
| 0 | Simulacre, unitaires sur le core, CI | Une ligne d'export |
| 1 | Tests figeant le comportement du panneau, puis #8/#9 et #4/#11 | Correctifs ciblés |
| 2 | #7, #10, #3, #5 | Correctifs ciblés |
| 3 | Extraction du panneau en module | Refonte garantie par la phase 1 |

**Règle de migration.** On n'extrait que ce que les tickets font toucher, et jamais avant que des
tests de niveau 2 aient figé le comportement existant du morceau concerné. Le panneau latéral est
le premier candidat, environ 350 lignes, parce que #8, #9, #4 et #7 y vivent tous.

## Décisions

| Sujet | Retenu | Écarté |
|-------|--------|--------|
| Livrable | HTML autonome produit par build | Fichiers séparés servis à côté |
| Source | Modules, extraits progressivement | Extraction en une fois |
| Runner unitaire | `node:test` | Vitest, Jest |
| Runner navigateur | `@playwright/test` | jsdom, happy-dom |
| Données de test | Simulacre paramétrable | Mode démo existant, non paramétrable |
| Amont | Fork divergent | Suivi du dépôt d'origine |

## Points ouverts

Sans effet sur cette infrastructure, mais bloquants pour une partie du backlog. Voir
`projects/tasks_app/BACKLOG.md`.

- Vocabulaire métier et modèle de données : *domaine*, *chantier*, *produit*, *offre de service*.
  Bloque #6, #12, #13, et structure #1.
- Geste utilisateur exact derrière #2.

## Dette de structure repérée, non traitée

Aucun de ces points ne gêne le travail en cours. Les corriger maintenant reviendrait à déplacer
des fichiers sans filet.

- Le Whiteboard est un widget TaskFlow mais vit hors de `projects/tasks_app/`.
- `projects/Artefactory/` et `projects/widget_app/` semblent être deux états du même projet.
- Conventions de nommage des dossiers mélangées.
- Six fichiers de documentation à la racine de `projects/tasks_app/`.
