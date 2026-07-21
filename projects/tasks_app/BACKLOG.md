# Backlog TaskFlow

Demandes issues du board projet. Contexte : instance Grist SecNumCloud (La Suite numérique),
intégration des widgets via « Custom URL » (le catalogue `manifest.json` n'est pas exploitable
sur cette instance, la variable `GRIST_WIDGET_LIST_URL` n'étant pas accessible).

## À traiter

| # | Demande | Cible | Cause identifiée |
|---|---------|-------|------------------|
| 8 | Le champ description du panneau latéral ne fonctionne pas | gantt | `updateField('description', …, true)` l. 2355 : le flag `noSave` empêche la persistance |
| 9 | Les champs du panneau latéral ne se sauvegardent pas | gantt | Même cause que #8, sur le titre l. 2280. Les autres champs persistent déjà |
| 4 | Ne pas fermer la fenêtre tâche quand on clique sur une autre tâche | gantt | `.panel-overlay` capte le clic et ferme le panneau |
| 11 | Pouvoir scroller le Gantt quand le panneau latéral est ouvert | gantt | Le scroll fonctionne, mais l'overlay neutralise clics et drag. Même cause que #4 |
| 7 | Recherche dans les sélecteurs dépendance / personne / tâche racine | gantt | Dropdowns maison sans champ de recherche ; le parent impose un détachement avant reparentage |
| 10 | Replier toutes les tâches d'un coup (repli seul, pas le dépli) | gantt | Repli par tâche existant ; `_expandAllForExport` / `_restoreExpandState` réservées à l'export, non exposées |
| 3 | Masquer les onglets Dashboard, Kanban, Calendar, Whiteboard | index | Onglets désactivés par indicateur, entrées conservées |
| 5 | Performance à l'ouverture du Gantt | gantt | À mesurer, aucun ordre de grandeur disponible |
| 2 | Conserver le widget Gantt lors d'une navigation entre tables | gantt | Geste utilisateur à préciser |
| 6 | Filtrer par Domaine | gantt | Notion absente du modèle |
| 13 | Vue Gantt depuis une fiche projet ou chantier | à définir | Dépend du modèle de données |

## Relevé en cours d'analyse, hors demandes

| Sujet | Cible | Détail |
|-------|-------|--------|
| Données de démonstration injectées dans un document réel | gantt | Le repli automatique l. 3142 teste `tasks.length === 0`, pas l'absence de Grist. Sur un document connecté mais vide, 13 tâches fictives et le badge « Démo » apparaissent au bout de 2,8 s |
| Échap ferme le panneau depuis un champ de saisie | gantt | Le listener l. 3070 n'exclut pas `input` et `textarea`. Combiné à #8 et #9, la saisie en cours est perdue |

## Reporté

| # | Demande | Raison |
|---|---------|--------|
| 1 | Renommage de colonne sans impact, libellés modifiables | Sujet lourd : identifiants de colonnes et de tables codés en dur, aucun mapping déclaré au `grist.ready()`, libellés affichés en chaînes littérales |
| 12 | Localisation de la vision consolidée du temps par chantier | Vocabulaire métier à clarifier |

## Questions à poser

**Modèle de données et vocabulaire métier.** Les demandes emploient *domaine*, *chantier*,
*produit*, *offre de service*, *fiche projet*. Le widget ne connaît que `Tasks`, `Team` et
`Projects`. Faut-il adapter le widget à un schéma déjà en place, ou étendre le modèle TaskFlow ?
Réponse bloquante pour #6, #12 et #13, et structurante pour #1.

**Consolidation du temps (#12).** Rien n'est stocké côté widget : les totaux sont recalculés à la
volée depuis `Tasks.charges` et `estimationH`. Reste à savoir quelles colonnes le document utilise
réellement.

**Navigation (#2).** Quel geste exactement : changement de page Grist, changement de table liée,
ou sélection depuis une autre vue ?

**Onglets (#3).** Seuls Gantt et Plan restent visibles, à confirmer.

**Performance (#5).** Nombre de tâches du document et durée constatée à l'ouverture.
