# Release et suivi des PR

**But :** livrer en production par une action manuelle unique, et que chaque PR incluse dans une
livraison porte elle-même la trace de sa mise en ligne, sans script maison à maintenir.

**Approche :** `semantic-release` déclenché en `workflow_dispatch`. Il calcule la version, pose le
tag, crée la release et ses notes, commente chaque PR incluse et lui pose un label. Le même run
enchaîne la construction et la publication du site. `main` ne tague plus, il publie `/dev/`.

**Outillage :** `semantic-release` et quatre plugins, installés depuis un manifeste dédié. Aucune
action tierce, aucun script ajouté.

## Contraintes globales

- La policy Actions du dépôt n'autorise que les actions publiées par GitHub plus
  `github/codeql-action/*`, avec épinglage par SHA imposé. La conception ne doit ajouter aucune
  action tierce.
- Le ruleset `Main` exige une PR, n'autorise que le rebase et ne comporte aucun acteur en
  dérogation. Rien ne doit committer sur `main`.
- Le ruleset `Tags de version` interdit la suppression et le non-fast-forward sur `refs/tags/v*`.
  La création reste libre.
- L'environnement `github-pages` n'accepte les déploiements que depuis `main` et les tags `v*`.
- Un évènement émis avec le `GITHUB_TOKEN` d'un workflow ne déclenche aucun autre workflow. Seuls
  `workflow_dispatch` et `repository_dispatch` échappent à cette règle.
- `zizmor` passe en persona `regular` sur tous les workflows.
- Commentaires et messages en français.

## Pièges relevés à l'analyse

**Le dépôt déclaré dans `package.json` est le mauvais.** Le champ `repository.url` pointe sur
`nicO1asFr/Widgets-Grist`, l'upstream dont ce dépôt est issu. `semantic-release` lit ce champ avant
le remote git : sans correction, il tenterait de créer la release chez Nicolas et échouerait sur les
droits. Le champ est faux indépendamment de ce chantier, il est corrigé à la source plutôt que
contourné par un `repositoryUrl` dans la configuration.

**Une release créée par un workflow ne déclenche pas les workflows.** Le token du run n'émet pas
d'évènement `release`. Toute conception où la release est créée par la CI et la publication
déclenchée par l'évènement ne peut pas fonctionner. La publication doit être enchaînée dans le même
run.

**Un déploiement Pages porté par la ref d'un tag ne remplace pas le contenu servi.** Constaté les 10
et 14 août : le site conservait l'ancienne version. La republication depuis `main` fonctionne, elle.
Tout le chemin de release reste donc sur la ref `main`.

**Le push du tag demande des identifiants.** `semantic-release` pousse le tag lui-même. Le
`persist-credentials: false` posé partout ailleurs prive le run des identifiants du checkout ; le
relais est pris par l'URL authentifiée que `semantic-release` construit depuis `GITHUB_TOKEN`. Si
le push échoue malgré tout, le repli est `persist-credentials: true` sur ce seul job, avec un
`zizmor: ignore[artipacked]` justifié.

**Les dépendances de release n'ont rien à faire dans le manifeste principal.** `npm ci` tourne dans
les jobs de tests unitaires, de bout en bout et de construction du site. `semantic-release` y
ajouterait plusieurs centaines de paquets sans usage. Elles vivent dans un manifeste séparé,
installé par le seul job qui en a besoin.

## Structure des fichiers

| Fichier | Responsabilité |
|---------|----------------|
| `.github/workflows/pages.yml` | Nouveau : construction et déploiement du site, appelable |
| `.github/workflows/release.yml` | Nouveau : release manuelle puis publication |
| `.github/workflows/ci.yml` | Modifié : tests, puis appel de `pages.yml` sur `main` |
| `.releaserc.json` | Nouveau : configuration `semantic-release` |
| `.github/release/package.json` | Nouveau : dépendances de release, avec lockfile |
| `.github/dependabot.yml` | Modifié : suivi du nouveau manifeste |
| `package.json` | Modifié : correction du dépôt déclaré |
| `scripts/next-version.js` | Supprimé |
| `tests/unit/next-version.test.js` | Supprimé |
| `scripts/check-commits.js` | Modifié : la grammaire importée du script supprimé y est réintégrée |
| `CLAUDE.md`, `projects/tasks_app/CLAUDE.md` | Modifiés : section CI/CD réécrite, repère de version |

## Détail des fichiers

### `.github/workflows/pages.yml`

Reprise à l'identique des jobs `pages-build` et `pages-deploy` de `ci.yml`, sous `on: workflow_call`
sans entrée. Aucune logique nouvelle. Le job de construction résout `releases/latest` pour la
racine et `main` pour `/dev/`, comme aujourd'hui.

Une seule évolution de contenu : l'estampille de `/dev/` passe du littéral `dev` à la sortie de
`git describe --tags --always`, soit `v1.19.2-12-gbfa201d`. Le checkout de `dev-src` étant déjà en
`fetch-depth: 0`, les tags sont disponibles. Cela restitue, en mieux, ce que les tags par merge
donnaient : le nombre de commits qui séparent la nightly de la production se lit dans le widget.

Le job de déploiement conserve son `concurrency: pages` et son `environment: github-pages`.

### `.github/workflows/release.yml`

Déclenchement `workflow_dispatch` seul, avec une entrée booléenne `simulation` qui passe
`--dry-run` : la version calculée et les notes sont affichées, rien n'est publié.

Job `release` :

- checkout de `main`, `fetch-depth: 0`, `persist-credentials: false`
- `actions/setup-node` sur `.nvmrc`
- `npm ci --prefix .github/release`
- `./.github/release/node_modules/.bin/semantic-release` avec `GITHUB_TOKEN`, dans une étape
  identifiée. Le binaire est appelé par son chemin plutôt que par `npx` : le processus doit avoir
  la racine du dépôt pour répertoire courant, c'est là que sont le dépôt git et `.releaserc.json`
- permissions du job : `contents: write`, `issues: write`, `pull-requests: write`

Job `publication` : `uses: ./.github/workflows/pages.yml`, conditionné à la présence d'une version
en sortie de l'étape précédente, donc sauté quand il n'y avait rien à livrer. Le job appelant
déclare les permissions dont le workflow appelé a besoin : `contents: read`, `pages: write`,
`id-token: write`, `actions: read`.

### `.github/workflows/ci.yml`

- le déclencheur `release:` est retiré, plus aucune release n'est créée hors de `release.yml`
- l'entrée `republier` du `workflow_dispatch` est retirée, le déclenchement manuel devient nu et
  rejoue simplement les tests puis la publication
- les gardes `github.event_name != 'release' && !inputs.republier` disparaissent des quatre jobs de
  contrôle
- le job `tag` est supprimé
- le job `republication` est supprimé
- les jobs `pages-build` et `pages-deploy` sont remplacés par un job `publication` qui appelle
  `pages.yml`, conditionné à `push` sur `main` ou au déclenchement manuel, et dépendant de `tests`

Le job `tests` reste le contexte unique exigé par le ruleset, ainsi que le job `commits` sur les PR.

### `.releaserc.json`

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/exec", { "successCmd": "echo version=<%= nextRelease.version %> >> $GITHUB_OUTPUT" }],
    ["@semantic-release/github", {
      "successComment": "Livré dans la [version <%= nextRelease.version %>](https://github.com/cesar-richard-ei/Widgets-Grist/releases/tag/<%= nextRelease.gitTag %>), en ligne sur https://cesar-richard-ei.github.io/Widgets-Grist/",
      "releasedLabels": ["livré"],
      "failTitle": false
    }]
  ]
}
```

Ni `npm`, ni `changelog`, ni `git` : aucun commit n'est poussé sur `main`, le ruleset n'a pas à être
touché et les notes de version restent le seul journal, à leur place.

`commit-analyzer` garde son comportement par défaut : un lot composé uniquement de `build`, `chore`,
`ci`, `docs`, `refactor`, `style` ou `test` ne produit pas de version. Le dispatch répond alors qu'il n'y a rien à
livrer, et le job de publication est sauté.

`successCmd` n'est exécuté que si une version est publiée. Son absence de sortie est donc le signal
qui conditionne la publication.

### `.github/release/package.json`

Manifeste privé sans script, déclarant `semantic-release`, `@semantic-release/exec` et
`@semantic-release/github` en dépendances de développement, avec son `package-lock.json`. Les
plugins `commit-analyzer` et `release-notes-generator` arrivent avec `semantic-release`.

### `.github/dependabot.yml`

Une entrée `npm` supplémentaire sur `/.github/release`, hebdomadaire, préfixe de commit
`chore(deps)`, groupée comme l'entrée existante.

### `package.json`

`repository.url` corrigé vers `https://github.com/cesar-richard-ei/Widgets-Grist.git`. Le champ
`author` reste tel quel, le dépôt reste dérivé du travail de Nicolas.

### Labels du dépôt

Création du label `livré`, avec une description qui le distingue de `A tester`. La file de
vérification produit devient la recherche `is:merged label:"A tester" -label:livré`.

## Ce qui disparaît

| Supprimé | Repris par |
|----------|------------|
| `scripts/next-version.js` et son test | `@semantic-release/commit-analyzer` |
| job `tag` | `semantic-release`, au moment de la livraison |
| job `republication` et entrée `republier` | l'appel direct à `pages.yml` |
| déclencheur `release:` de `ci.yml` | plus aucune release hors du workflow |
| tag `vX.Y.Z` sur chaque push de `main` | estampille `git describe` sur `/dev/` |

## Décisions prises

**Les tags ne marquent plus que les livraisons.** Un tag est un pointeur public qui répond à la
question de ce qui est parti chez les utilisateurs. Taguer chaque merge avait produit une douzaine
de versions ne désignant rien de livrable, la dernière release stable étant `v1.19.2` alors que les
tags atteignaient `v1.22.0`. La trace intermédiaire est reprise par l'estampille `/dev/`.

**Les pre-releases sont retirées.** Elles servaient à livrer sans bouger la racine. `/dev/` remplit
ce rôle et le fait mieux, puisqu'il suit `main` en continu. Le chemin de bascule d'une pre-release
en stable, et l'indirection qu'il impose, tombent avec elles.

**Un lot sans changement fonctionnel ne produit pas de version.** Comportement par défaut de
`semantic-release`, retenu tel quel : un dispatch sur un lot de refactorisations répond qu'il n'y a
rien à livrer plutôt que d'incrémenter un patch et de repousser le site.

## Vérification

1. Dispatch en mode simulation sur `main` : la version calculée et les notes s'affichent, aucun tag
   ni release n'apparaît.
2. Dispatch réel : le tag est poussé, la release est créée avec ses notes, chaque PR du lot reçoit
   un commentaire et le label `livré`, la racine sert le nouveau contenu.
3. Second dispatch immédiat : réponse « rien à livrer », aucun job de publication.
4. Push sur `main` : les contrôles passent, `/dev/` est mis à jour, son estampille affiche le
   nombre de commits depuis la dernière livraison, la racine est inchangée.
5. `actionlint` et `zizmor` passent sur les trois workflows.

## Suites possibles, hors périmètre

- `actions/labeler`, action publiée par GitHub donc déjà autorisée, poserait `A tester`
  automatiquement selon les chemins touchés par la PR, en configuration déclarative.
- `scripts/check-commits.js` fait ce que `commitlint` fait avec un fichier de configuration. Aligner
  les deux grammaires éviterait qu'un message accepté en PR soit interprété autrement au calcul de
  version.
