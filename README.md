# Widgets Grist

Collection de **widgets personnalisés** pour [Grist](https://www.getgrist.com/), la plateforme open-source de bases de données collaboratives.

Ce repo sert de **catalogue de widgets** hébergé sur GitHub Pages. Les widgets publiés sont directement utilisables dans Grist.

---

## Widgets publiés

Ces widgets sont stables et prêts à l'emploi.

### TaskFlow

Suite de 3 widgets de gestion de projet, utilisables ensemble ou séparément.

| Widget | Description | Lien direct |
|--------|-------------|-------------|
| **Kanban** | Tableau de tâches avec drag & drop, filtres, modales | [Utiliser](https://nic01asfr.github.io/Widgets-Grist/taskflow/kanban/) |
| **Gantt** | Diagramme de planification interactif | [Utiliser](https://nic01asfr.github.io/Widgets-Grist/taskflow/gantt/) |
| **Calendar** | Vue calendrier mois/semaine/jour | [Utiliser](https://nic01asfr.github.io/Widgets-Grist/taskflow/calendar/) |

Les 3 widgets se synchronisent automatiquement quand ils sont dans le même document Grist (sélection partagée).

Pour préparer les tables d'un document, ou vérifier qu'un changement de structure ne cassera rien :
[Structure des tables attendue par TaskFlow](#structure-des-tables-attendue-par-taskflow).

---

## Utilisation

### Option 1 : URL directe

Dans Grist : **Add Widget** → **Custom** → **Enter Custom URL**

Collez l'URL du widget souhaité (voir tableau ci-dessus).

### Option 2 : Catalogue de widgets (Grist self-hosted)

Configurez votre instance Grist pour utiliser ce repo comme source de widgets :

```bash
GRIST_WIDGET_LIST_URL=https://nic01asfr.github.io/Widgets-Grist/manifest.json
```

Les widgets apparaîtront automatiquement dans le sélecteur "Custom Widget".

### Option 3 : Fork et personnalisation

1. Forkez ce repo
2. Modifiez les widgets dans `projects/`
3. Publiez vers `published/`
4. Activez GitHub Pages sur votre fork

---

## Structure du repo

```
published/         ← Widgets en production (déployés sur GitHub Pages)
projects/          ← Projets en développement
skills/            ← Documentation technique et patterns
scripts/           ← Outils de build et publication
```

Pour contribuer ou comprendre l'architecture : voir [CLAUDE.md](CLAUDE.md)

---

## Structure des tables attendue par TaskFlow

Cette section décrit **exactement** ce que les widgets lisent et écrivent dans le document Grist.
Elle s'adresse à qui tient la structure du document et veut préparer ses tables, ou vérifier
qu'un changement ne cassera rien.

### Deux règles de lecture, et une seule exception

**Règle générale : les colonnes sont lues par leur identifiant**, pas par leur libellé. Une colonne
dont l'identifiant ne correspond pas est traitée comme absente, sans message d'erreur.

**Exception : le rattachement d'une tâche à son chantier et la parenté entre tâches se reconnaissent
au type de la colonne, pas à son nom.** Le widget cherche dans `Tasks` :

- une colonne de type `Ref:Chantiers` : c'est le rattachement au chantier, **quel que soit son nom**
  (`chantier`, `Chantiers`, ou autre) ;
- une colonne `parentTask` de type `Ref:Tasks` : c'est la décomposition en sous-tâches. Si
  `parentTask` pointe vers `Chantiers`, elle est comprise comme un rattachement au chantier.

Cette exception existe parce que les identifiants des deux tables se recouvrent : se fier à la
valeur rattacherait des tâches à des chantiers sans rapport. C'est le type qui tranche.

### Le piège du renommage

Grist régénère l'identifiant d'une colonne quand on change son libellé, **sauf si la colonne a été
déliée** (`untieColIdFromLabel`). Renommer une colonne encore liée change donc son identifiant, et
le widget ne la retrouve plus : les données disparaissent de l'affichage sans erreur, et une colonne
vide peut être recréée en double.

Les widgets délient automatiquement les colonnes qu'ils connaissent. Une colonne renommée **avant**
cette protection a déjà perdu son identifiant d'origine et doit être remise à la main une fois.

Pour lire l'identifiant réel d'une colonne : panneau de droite dans Grist, onglet **Column**, champ
**COLUMN ID**.

### `Tasks`

| Identifiant | Type | Rôle |
|---|---|---|
| `titre` | Text | Libellé affiché |
| `description` | Text | Corps |
| `dateDebut`, `dateEcheance` | Date | Bornes de la barre. Un jalon porte la même date des deux côtés |
| `statut` | Choice | Les valeurs viennent des Choices de la colonne. Le **dernier** choix est traité comme la clôture |
| `priorite` | Choice | `1` à `4` (1 = critique). Toute autre valeur est lue comme `3` |
| `type` | Choice | `jalon` pour un jalon, toute autre valeur pour une tâche |
| `progression` | Numeric | 0 à 100. Recalculée pour un parent, jamais écrite |
| `projet` | Ref:Projects | Facultatif : à défaut, le projet du chantier est repris |
| `assignees` | RefList:Team | Intervenants |
| `Responsable` | Ref:Team | Porte la couleur de la ligne et la pastille de la colonne de gauche |
| `dependDe` | RefList:Tasks | Dépendances, tracées en courbes |
| `tags` | ChoiceList | Étiquettes |
| `estimationH`, `tempsPasse` | Numeric | Heures |
| `couleur` | Text | Couleur hexadécimale qui prime sur tout le reste pour cette ligne |
| `subtasks` | Text | JSON `[{id, text, done}]`, la case à cocher du volet |
| (une colonne) | Ref:Chantiers | Rattachement au chantier, **nom libre** |
| `parentTask` | Ref:Tasks | Sous-tâche d'une autre tâche |
| `charges` | Text | JSON `[{teamId, heures}]`, créée par le widget Plan |
| `dateCloture` | Date | Posée au passage au statut de clôture, créée par le widget Plan |

### `Chantiers`

Ces identifiants sont attendus **tels quels**.

| Identifiant | Type | Rôle |
|---|---|---|
| `Nom_du_chantier` | Text | Libellé de la ligne de niveau 0 |
| `Description` | Text | Corps |
| `Date_debut`, `Date_fin` | Date | Bornes. Préremplies depuis les tâches si vides, et modifiables |
| `Projets` | RefList:Projects | Rattachement aux projets. **Le premier de la liste** porte l'affichage |
| `Contributeurs` | RefList:Team | Remontée des intervenants, écrite à l'enregistrement du volet |
| `Responsable` | Ref:Team | Porte la couleur de la ligne |

Sans table `Chantiers`, le Gantt retombe sur une hiérarchie de tâches seule et le bouton de création
d'un chantier disparaît.

### `Projects`

| Identifiant | Type | Rôle |
|---|---|---|
| `nom` | Text | Libellé du bandeau de groupe |
| `couleur` | Text | Couleur de repli du bandeau |
| `responsable` | Ref:Team | **Sa couleur d'équipe teinte le bandeau du projet** |
| `dateDebut`, `dateFin` | Date | Bornes |
| `actif` | Bool | Un projet inactif n'est plus proposé |
| `Categorie` | Ref:Categorie_de_projet | Affichée en badge sur le bandeau |

### `Team`

| Identifiant | Type | Rôle |
|---|---|---|
| `nom` | Text | Libellé et initiales de la pastille |
| `couleur` | Text | Couleur hexadécimale de la personne, reprise partout |
| `email`, `avatar`, `role` | Text / Choice | Informations |
| `actif` | Bool | Une personne inactive n'est plus proposée |
| `capaciteHebdo` | Numeric | Heures par semaine, 35 par défaut. Créée par le widget Plan |
| `indispos` | Text | Ancien format JSON, remplacé par la table `Disponibilites` |

### Tables annexes

`Categorie_de_projet` : une colonne `Categorie` dont le texte s'affiche en badge sur le bandeau.

`Disponibilites`, créée par le widget Plan : `membre` (Ref:Team), `type` (Text), `dateDebut` et
`dateFin` (Date), `dispo` (Numeric **de 0 à 1**, part de capacité conservée), `commentaire` (Text).

### Colonnes créées par le widget Plan

Ouvrir le Plan crée `Tasks.charges`, `Tasks.dateCloture`, `Team.capaciteHebdo`, `Team.indispos` et la
table `Disponibilites` si elles manquent. Les autres widgets ne les créent jamais et **n'écrivent une
colonne que si elle existe déjà** : un document qui n'ouvre jamais le Plan reste sans aucune de ces
colonnes.

### Ce qui se passe si une colonne manque

Rien ne casse et rien n'est écrit à l'aveugle : la fonctionnalité correspondante disparaît. Sans
`Responsable`, le mode de couleur par responsable quitte le sélecteur. Sans table `Chantiers`, le
bouton de création d'un chantier n'apparaît pas. Avant toute écriture, le widget retire du
formulaire les colonnes que la table ne porte pas.

Le corollaire est qu'une erreur de structure **ne produit pas de message d'erreur**, seulement une
fonctionnalité absente ou un affichage vide. En cas de doute, la console du navigateur journalise ce
qui a été lu, table par table.

---

## Contribuer

- **Signaler un bug** : [Ouvrir une issue](../../issues/new)
- **Proposer une amélioration** : [Discussions](../../discussions)
- **Voter pour un projet** : Ajoutez une reaction sur l'issue du projet

---

## Ressources

- [Documentation Grist](https://support.getgrist.com/)
- [Grist Custom Widgets](https://support.getgrist.com/widget-custom/)
- [Grist Plugin API](https://support.getgrist.com/code/modules/grist_plugin_api/)

---

## Licence

MIT — Libre d'utilisation, modification et distribution.
