# Infrastructure de test et trajectoire d'assainissement

## Organisation des tests de bout en bout

Un fichier par **domaine fonctionnel**, jamais par lot de livraison : un test décrit le
comportement attendu aujourd'hui, pas ce qui a changé. Proscrire les titres du genre « n'est plus »,
« désormais », « au lieu de » : l'historique vit dans git, pas dans la suite de tests.

| Fichier | Domaine |
|---|---|
| `gantt-barre-outils.spec.js` | composition de la barre d'outils : ce qu'elle propose et ce qu'elle ne propose plus |
| `fiche-projet.spec.js` | fiche d'un projet : cadrage, feuille de route, périmètre et lecture seule |
| `gantt-timeline.spec.js` | calage sur le jour, navigation, profondeur historique, en-tête des mois, jalon déplaçable |
| `gantt-bandeaux-projet.spec.js` | bandeaux de projet, teintes, repli, alignement des deux colonnes |
| `gantt-colonne-gauche.spec.js` | largeurs, pastilles, contenu d'une ligne, repli, barre étroite |
| `gantt-lisibilite.spec.js` | titres reportés, noms de jalons, bulle de survol, contrastes |
| `gantt-chantiers.spec.js` | détection du rattachement par type, hiérarchie, volet et création |
| `gantt-volet.spec.js` | composition et ordre des blocs du volet |
| `gantt-creation.spec.js` | bouton d'ajout, types, duplication, listes filtrables |
| `gantt-saisie.spec.js` | persistance de la saisie, bascule entre lignes, gestes souris |
| `gantt-couleurs-et-defauts.spec.js` | réglages d'ouverture, couleur des lignes, relecture au retour |
| `gantt-filtres-cross-page.spec.js` | filtres partagés entre vues |
| `diagnostic.spec.js` | schéma semé, lectures, repli démonstration, tables refusées, badge de version |
| `plan-chantiers.spec.js`, `plan-journal.spec.js` | plan de charge |
| `launcher.spec.js` | page de lancement |

### Le socle : `tests/e2e/documents.js`

Un seul endroit décrit les documents Grist et les helpers d'ouverture. Avant, 32 fichiers
recopiaient le même jeu de colonnes : une évolution de schéma demandait de passer partout, et les
fixtures divergeaient silencieusement.

- `documentCible(nomColonne)` : modèle cible, table `Chantiers` et colonne de rattachement dont le
  nom est libre, le lien se reconnaissant à son **type** ;
- `documentParentRepointe()` : copie de travail où `parentTask` désigne un chantier ;
- `documentSansChantiers()` : ancien modèle, hiérarchie entre tâches ;
- `sansColonne(doc, colonne)` : pour ce qui doit disparaître avec sa donnée ;
- `colonneCalculee(doc, table, colonne)` : colonne lisible qui refuse l'écriture, comme une formule ;
- `avecLiens(doc, liens)` : pose des dépendances par titre, fin→début et début→début ;
- `ouvrirGantt` / `ouvrirPlan(page, doc, options)` avec `theme`, `largeur`, `reglages`, `refuser`,
  `optionsSection` ;
- `ligne`, `deplier`, `toutDeplier`, `ouvrirVolet`, `champTache`, `contraste`.

**Le document de référence porte le schéma complet** attendu par le widget. Une colonne manquante
le ferait la créer à l'ouverture puis relire la table : les mesures de lecture deviennent fausses et
chaque test paie une écriture de structure.

**Un seul appel à `ouvrirGantt` par test.** La préparation du stockage local est gardée par un
drapeau en `sessionStorage`, pour qu'un rechargement de page ne l'efface pas au milieu d'un test de
persistance. Un second appel dans le même test ne poserait donc pas ses réglages.

**`ouvrirVolet` attend la fin de la transition** d'ouverture : mesurer une largeur pendant que le
volet glisse donne une valeur intermédiaire, et un glisser démarré à ce moment part d'une poignée en
mouvement.

### Le simulacre refuse ce que Grist refuse

`applyUserActions` lève sur une colonne absente ou calculée, et restaure l'instantané : le lot entier
est perdu, comme sur un vrai document. Sans cette vérification, le simulacre acceptait n'importe quel
nom de colonne. La création de chantier était couverte, verte ici, et cassée sur le document du
métier : elle posait `Chantiers.Projets` sans savoir si la colonne s'écrit.

Conséquence pour les fixtures : une écriture vers une colonne que le document de test ne déclare pas
fait désormais échouer le test au lieu de passer inaperçue.

### Le simulacre sert ce que Grist sert

`onRecord` ne rend pas l'enregistrement tel qu'il est stocké : Grist développe les références
(`expandRefs`, actif par défaut) et décode les valeurs (`keepEncoded`, inactif par défaut). Un
widget qui attend un identifiant reçoit donc un nom, et une date arrive en objet plutôt qu'en
horodatage. Le simulacre rendait les valeurs brutes, ce qui a rendu verts les tests d'une fiche
dont toutes les personnes affichaient « Non renseigné » sur le document du métier.

Il applique désormais ces deux options, avec les défauts de Grist. Un widget qui veut des valeurs
brutes le demande : `onRecord(cb, { expandRefs: false, keepEncoded: true })`.

Demander ces options ne suffit pas : `onRecord` délègue à `fetchSelectedRecord`, que le serveur
exécute à sa façon. Le simulacre reproduit deux serveurs observés, `refsAffichees: true` qui sert
une référence simple sous son libellé, et `refsOpaques: true` qui la sert sous une forme
inexploitable, les listes gardant leurs identifiants dans les deux cas. Un widget ne doit donc rien
attendre de l'enregistrement servi hormis son identifiant.

Reste non simulé, faute d'équivalent ici : `includeColumns`, dont le défaut `shown` limite le
record aux colonnes montrées dans le panneau de droite.

### Trois pièges qui rendent un test vert et faux

**Lire l'ordre du DOM** quand c'est l'ordre affiché qui compte : une règle CSS `order` peut
contredire le gabarit, et le test ne verra rien. Mesurer les positions à l'écran.

**Croire qu'un élément présent est visible** : un parent qui découpe son débordement suffit à le
masquer sans que `toBeVisible` ne bronche. Vérifier aussi que rien ne le découpe.

**Choisir une donnée qui ne discrimine pas** : un mois dont l'abréviation est identique au nom
complet, ou une barre déjà couverte par un autre cas. Comparer aux constantes du widget plutôt qu'à
une valeur écrite en dur.
