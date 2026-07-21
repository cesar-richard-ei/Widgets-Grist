# Infrastructure de test, phase 0

**But :** disposer d'un simulacre de Grist et d'une couverture unitaire du core, exécutés en
intégration continue, sans modifier le comportement d'aucun widget.

**Approche :** le core `taskflow-core.js` devient requerable en Node par une garde inerte dans le
navigateur. Ses fonctions pures sont couvertes par `node:test`. Ses trois fonctions couplées à
Grist reçoivent déjà `grist` en paramètre : elles sont testées en lui passant le simulacre, sans
aucune injection.

**Outillage :** Node 20, `node:test`, `node:assert/strict`. Aucune dépendance en phase 0.
Playwright n'arrive qu'en phase 1.

## Contraintes globales

- Node 20, la version de la CI. Pas de dépendance ajoutée dans cette phase.
- Un seul changement au code de production : la ligne d'export en fin de core.
- Ne jamais éditer la copie du core inlinée dans les `.html`. Éditer le source puis
  `npm run build:taskflow`.
- Commentaires et messages en français.
- Aucun commit sans accord explicite. Les étapes de commit sont écrites mais restent en attente.

## Fidélité exigée du simulacre

Contraintes relevées dans le code réel, non négociables sous peine de tests qui ne prouvent rien.

- `fetchTable` sur une table inconnue **lève**. `ensureSchema()` (`gantt.html:2893`) détecte
  l'existence d'une table en interceptant cette exception. Un simulacre qui rend un tableau vide
  empêcherait toute création de schéma.
- `fetchTable` rend le **format colonnaire** `{ id: [...], colId: [...] }`, toutes colonnes
  déclarées présentes, valeur `null` si absente de l'enregistrement.
- Les tables `_grist_Tables` et `_grist_Tables_column` restent cohérentes avec les tables
  applicatives après toute action de schéma.
- Le retour d'`applyUserActions` n'est exploité par aucun widget. Un `{ retValues: [...] }`
  plausible suffit.

## Structure des fichiers

| Fichier | Responsabilité |
|---------|----------------|
| `projects/tasks_app/core/taskflow-core.js` | Modifié : ligne d'export en fin de fichier |
| `tests/fake-grist.js` | Simulacre : document en mémoire, actions, abonnements, journal |
| `tests/fixtures/documents.js` | Documents de départ réutilisables |
| `tests/unit/core-conversion.test.js` | `columnarToRows`, statuts |
| `tests/unit/core-charges.test.js` | Charges et périodes |
| `tests/unit/core-grist.test.js` | Les trois fonctions couplées, contre le simulacre |
| `tests/unit/fake-grist.test.js` | Le simulacre lui-même |
| `.github/workflows/tests.yml` | Job de test et vérification de synchronisation du core |

---

### Tâche 1 : rendre le core requerable et couvrir la conversion et les statuts

**Fichiers :**
- Modifier : `projects/tasks_app/core/taskflow-core.js:323`
- Créer : `tests/unit/core-conversion.test.js`
- Modifier : `package.json`

**Interfaces :**
- Produit : `require('../../projects/tasks_app/core/taskflow-core.js')` rend l'objet `TF`.

- [ ] **Étape 1 : écrire le test qui échoue**

`tests/unit/core-conversion.test.js` :

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/taskflow-core.js');

test('columnarToRows convertit le format colonnaire en lignes', () => {
    const rows = TF.columnarToRows({ id: [1, 2], titre: ['A', 'B'] });
    assert.deepEqual(rows, [{ id: 1, titre: 'A' }, { id: 2, titre: 'B' }]);
});

test('columnarToRows laisse passer un tableau deja converti', () => {
    const input = [{ id: 1 }];
    assert.equal(TF.columnarToRows(input), input);
});

test('columnarToRows rend un tableau vide sur entree vide ou absente', () => {
    assert.deepEqual(TF.columnarToRows(null), []);
    assert.deepEqual(TF.columnarToRows({}), []);
});

test('buildStatusConfig retombe sur les statuts par defaut si la liste est vide', () => {
    const cfg = TF.buildStatusConfig([], 'choice');
    assert.equal(cfg.source, 'default');
    assert.deepEqual(cfg.values, ['todo', 'inprogress', 'review', 'done']);
    assert.equal(cfg.terminalValue, 'done');
    assert.equal(cfg.firstValue, 'todo');
});

test('buildStatusConfig complete le libelle et la couleur des codes connus', () => {
    const cfg = TF.buildStatusConfig([{ value: 'todo' }], 'choice');
    assert.equal(cfg.source, 'choice');
    assert.equal(cfg.byValue.todo.label, 'À faire');
    assert.equal(cfg.byValue.todo.fillColor, '#94a3b8');
});

test('buildStatusConfig respecte un libelle explicite', () => {
    const cfg = TF.buildStatusConfig([{ value: 'todo', label: 'A traiter' }], 'choice');
    assert.equal(cfg.byValue.todo.label, 'A traiter');
});

test('buildStatusConfig tient le dernier statut pour terminal', () => {
    const cfg = TF.buildStatusConfig([{ value: 'a' }, { value: 'b' }, { value: 'c' }], 'choice');
    assert.equal(cfg.terminalValue, 'c');
    assert.equal(cfg.firstValue, 'a');
});

test('getStatus rend un statut neutre pour une valeur inconnue', () => {
    const cfg = TF.buildStatusConfig([{ value: 'todo' }], 'choice');
    assert.deepEqual(TF.getStatus(cfg, 'inexistant'), {
        value: 'inexistant', label: 'inexistant', fillColor: '#94a3b8', textColor: '#ffffff'
    });
});

test('isTerminal ne reconnait que le dernier statut', () => {
    const cfg = TF.buildStatusConfig([{ value: 'a' }, { value: 'b' }], 'choice');
    assert.equal(TF.isTerminal(cfg, 'b'), true);
    assert.equal(TF.isTerminal(cfg, 'a'), false);
    assert.equal(TF.isTerminal(null, 'b'), false);
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
node --test tests/unit/core-conversion.test.js
```

Attendu : échec au chargement, `TF.columnarToRows is not a function`. Le `require` rend un objet
vide, le core n'exportant rien.

- [ ] **Étape 3 : ajouter la garde d'export**

En fin de `projects/tasks_app/core/taskflow-core.js`, après la parenthèse fermante de l'IIFE :

```js
// Export Node pour les tests. Inerte dans le navigateur, ou `module` n'existe pas.
if (typeof module !== 'undefined' && module.exports) module.exports = TF;
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```
node --test tests/unit/core-conversion.test.js
```

Attendu : succès.

- [ ] **Étape 5 : vérifier que les widgets ne sont pas cassés**

```
node scripts/build-taskflow.js
node scripts/build-taskflow.js --check
```

Attendu : la première commande met à jour les 6 widgets avec la ligne ajoutée, la seconde sort en
code 0. Ouvrir ensuite `projects/tasks_app/gantt.html` dans un navigateur et vérifier que le mode
démo s'affiche sans erreur en console. La garde doit être inerte.

- [ ] **Étape 6 : déclarer la commande de test**

Dans `package.json`, remplacer la valeur actuelle de `scripts.test` si elle existe, sinon
l'ajouter :

```json
"test": "node --test tests/unit/"
```

- [ ] **Étape 7 : lancer la suite complète**

```
npm test
```

Attendu : succès.

- [ ] **Étape 8 : commit, en attente d'accord**

```bash
git add projects/tasks_app/core/taskflow-core.js tests/unit/core-conversion.test.js package.json
git commit -m "test(taskflow): couvre la conversion et les statuts du core"
```

---

### Tâche 2 : couvrir les charges et les périodes

**Fichiers :**
- Créer : `tests/unit/core-charges.test.js`

**Interfaces :**
- Consomme : l'export du core, tâche 1.

- [ ] **Étape 1 : écrire le test qui échoue**

`tests/unit/core-charges.test.js` :

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/taskflow-core.js');

// Grist stocke les dates en secondes Unix.
const secondes = (annee, mois, jour) => Date.UTC(annee, mois, jour) / 1000;

test('parseCharges lit une repartition valide', () => {
    assert.deepEqual(
        TF.parseCharges('[{"teamId":1,"heures":5}]'),
        [{ teamId: 1, heures: 5 }]
    );
});

test('parseCharges convertit les valeurs textuelles en nombres', () => {
    assert.deepEqual(
        TF.parseCharges('[{"teamId":"2","heures":"3"}]'),
        [{ teamId: 2, heures: 3 }]
    );
});

test('parseCharges ecarte les entrees sans teamId', () => {
    assert.deepEqual(TF.parseCharges('[{"heures":5}]'), []);
});

test('parseCharges rend un tableau vide sur JSON invalide, absent ou non tableau', () => {
    assert.deepEqual(TF.parseCharges('pas du json'), []);
    assert.deepEqual(TF.parseCharges(null), []);
    assert.deepEqual(TF.parseCharges('{"teamId":1}'), []);
});

test('chargesToJson produit une forme relisible par parseCharges', () => {
    const json = TF.chargesToJson([{ teamId: '4', heures: '2' }]);
    assert.deepEqual(TF.parseCharges(json), [{ teamId: 4, heures: 2 }]);
});

test('chargeTotal somme les heures, depuis une chaine ou un tableau', () => {
    assert.equal(TF.chargeTotal('[{"teamId":1,"heures":5},{"teamId":2,"heures":3}]'), 8);
    assert.equal(TF.chargeTotal([{ teamId: 1, heures: 5 }]), 5);
    assert.equal(TF.chargeTotal(null), 0);
});

test('chargeByMember agrege les heures par personne sur plusieurs taches', () => {
    const taches = [
        { charges: '[{"teamId":1,"heures":4},{"teamId":2,"heures":2}]' },
        { charges: '[{"teamId":1,"heures":3}]' }
    ];
    assert.deepEqual(TF.chargeByMember(taches), { 1: 7, 2: 2 });
});

test('periodKey rend la semaine ISO', () => {
    // 2026-01-01 est un jeudi, donc en semaine 1.
    assert.equal(TF.periodKey(new Date(Date.UTC(2026, 0, 1)), 'week'), '2026-W01');
    // 2026-01-05 est le lundi de la semaine 2.
    assert.equal(TF.periodKey(new Date(Date.UTC(2026, 0, 5)), 'week'), '2026-W02');
});

test('periodKey rend le mois', () => {
    assert.equal(TF.periodKey(new Date(Date.UTC(2026, 6, 20)), 'month'), '2026-07');
});

test('periodRange aligne sur le lundi et enchaine les semaines', () => {
    // 2026-01-07 est un mercredi, la periode demarre au lundi 5.
    assert.deepEqual(
        TF.periodRange(new Date(Date.UTC(2026, 0, 7)), 'week', 3),
        ['2026-W02', '2026-W03', '2026-W04']
    );
});

test('periodRange aligne sur le premier du mois et franchit l annee', () => {
    assert.deepEqual(
        TF.periodRange(new Date(Date.UTC(2026, 10, 15)), 'month', 3),
        ['2026-11', '2026-12', '2027-01']
    );
});

test('shiftPeriods decale de semaines entieres', () => {
    const d = TF.shiftPeriods(new Date(Date.UTC(2026, 0, 5)), 'week', 2);
    assert.equal(d.toISOString().slice(0, 10), '2026-01-19');
});

test('chargeByMemberPeriod etale la charge sur la duree de la tache', () => {
    const taches = [{
        charges: '[{"teamId":1,"heures":10}]',
        dateDebut: secondes(2026, 0, 5),      // lundi
        dateEcheance: secondes(2026, 0, 9)    // vendredi, meme semaine ISO
    }];
    assert.deepEqual(TF.chargeByMemberPeriod(taches, 'week'), { 1: { '2026-W02': 10 } });
});

test('chargeByMemberPeriod ignore une tache sans dates ou sans charge', () => {
    assert.deepEqual(TF.chargeByMemberPeriod([{ charges: '[{"teamId":1,"heures":5}]' }], 'week'), {});
    assert.deepEqual(TF.chargeByMemberPeriod([{
        charges: '[]', dateDebut: secondes(2026, 0, 5), dateEcheance: secondes(2026, 0, 9)
    }], 'week'), {});
});

test('chargeMatrix regroupe selon la cle fournie', () => {
    const taches = [{
        projet: 7,
        charges: '[{"teamId":1,"heures":10}]',
        dateDebut: secondes(2026, 0, 5),
        dateEcheance: secondes(2026, 0, 9)
    }];
    const parProjet = TF.chargeMatrix(taches, (t) => t.projet, 'week');
    assert.deepEqual(parProjet, { 7: { '2026-W02': 10 } });
});

test('chargeMatrix en jours ouvres retombe sur le jour de debut si la periode n en contient aucun', () => {
    // Samedi a dimanche : aucun jour ouvre, la charge est portee par le jour de debut.
    const taches = [{
        charges: '[{"teamId":1,"heures":6}]',
        dateDebut: secondes(2026, 0, 10),
        dateEcheance: secondes(2026, 0, 11)
    }];
    const matrice = TF.chargeMatrix(taches, () => 'r', 'week', null, true);
    assert.deepEqual(matrice, { r: { '2026-W02': 6 } });
});
```

- [ ] **Étape 2 : lancer le test**

```
node --test tests/unit/core-charges.test.js
```

Attendu : succès, ces fonctions étant déjà implémentées. Il s'agit de tests de caractérisation,
qui figent le comportement existant.

Si un test échoue, **ne pas corriger le core**. Un écart signale que le comportement réel diffère
de ce que le plan supposait : corriger l'attente du test et le consigner en commentaire.

- [ ] **Étape 3 : commit, en attente d'accord**

```bash
git add tests/unit/core-charges.test.js
git commit -m "test(taskflow): couvre les charges et les periodes du core"
```

---

### Tâche 3 : socle du simulacre, document et lecture

**Fichiers :**
- Créer : `tests/fake-grist.js`
- Créer : `tests/fixtures/documents.js`
- Créer : `tests/unit/fake-grist.test.js`

**Interfaces :**
- Produit :
  - `createFakeGrist(document)` rend un objet `grist` utilisable par les widgets et le core.
  - `document` a la forme `{ NomTable: { columns: { colId: { type, widgetOptions } }, records: [...] } }`.
  - `grist.docApi.fetchTable(nom)` rend une promesse de format colonnaire, **rejette** si la table
    est inconnue.
  - `grist.docApi.listTables()` rend la liste des tables applicatives.
  - `grist._log` expose le journal des actions, `grist._doc` l'état courant.

- [ ] **Étape 1 : écrire le test qui échoue**

`tests/unit/fake-grist.test.js` :

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeGrist } = require('../fake-grist.js');
const { documentMinimal } = require('../fixtures/documents.js');

test('fetchTable rend le format colonnaire', async () => {
    const grist = createFakeGrist(documentMinimal());
    const data = await grist.docApi.fetchTable('Team');
    assert.deepEqual(data.id, [1, 2]);
    assert.deepEqual(data.nom, ['Alice', 'Bob']);
});

test('fetchTable rend null pour une colonne absente de l enregistrement', async () => {
    const grist = createFakeGrist({
        Tasks: { columns: { titre: { type: 'Text' }, statut: { type: 'Choice' } },
                 records: [{ id: 1, titre: 'A' }] }
    });
    const data = await grist.docApi.fetchTable('Tasks');
    assert.deepEqual(data.statut, [null]);
});

test('fetchTable rejette sur une table inconnue', async () => {
    const grist = createFakeGrist(documentMinimal());
    await assert.rejects(() => grist.docApi.fetchTable('Inexistante'), /Inexistante/);
});

test('listTables ne rend que les tables applicatives', async () => {
    const grist = createFakeGrist(documentMinimal());
    assert.deepEqual((await grist.docApi.listTables()).sort(), ['Tasks', 'Team']);
});

test('_grist_Tables reflete les tables du document', async () => {
    const grist = createFakeGrist(documentMinimal());
    const meta = await grist.docApi.fetchTable('_grist_Tables');
    assert.deepEqual(meta.tableId.sort(), ['Tasks', 'Team']);
    assert.equal(meta.id.length, 2);
});

test('_grist_Tables_column porte parentId, colId, type et widgetOptions', async () => {
    const grist = createFakeGrist(documentMinimal());
    const tables = await grist.docApi.fetchTable('_grist_Tables');
    const refTasks = tables.id[tables.tableId.indexOf('Tasks')];
    const cols = await grist.docApi.fetchTable('_grist_Tables_column');

    const index = cols.colId.indexOf('statut');
    assert.equal(cols.parentId[index], refTasks);
    assert.equal(cols.type[index], 'Choice');
    assert.equal(JSON.parse(cols.widgetOptions[index]).choices.length, 4);
});
```

`tests/fixtures/documents.js` :

```js
'use strict';

// Document de depart minimal, suffisant pour ensureSchema et loadStatusConfig.
function documentMinimal() {
    return {
        Tasks: {
            columns: {
                titre: { type: 'Text' },
                statut: {
                    type: 'Choice',
                    widgetOptions: JSON.stringify({
                        choices: ['todo', 'inprogress', 'review', 'done'],
                        choiceOptions: { done: { fillColor: '#10b981', textColor: '#ffffff' } }
                    })
                },
                projet: { type: 'Ref:Projects' },
                dateDebut: { type: 'Date' },
                dateEcheance: { type: 'Date' }
            },
            records: [{ id: 1, titre: 'Analyse', statut: 'todo' }]
        },
        Team: {
            columns: { nom: { type: 'Text' }, couleur: { type: 'Text' } },
            records: [
                { id: 1, nom: 'Alice', couleur: '#4f46e5' },
                { id: 2, nom: 'Bob', couleur: '#10b981' }
            ]
        }
    };
}

module.exports = { documentMinimal };
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
node --test tests/unit/fake-grist.test.js
```

Attendu : échec, `Cannot find module '../fake-grist.js'`.

- [ ] **Étape 3 : écrire le socle du simulacre**

`tests/fake-grist.js` :

```js
'use strict';

/* Simulacre de l'API Grist plugin, adosse a un document en memoire.
 * Fidelites exigees, relevees sur le code reel des widgets :
 *   - fetchTable LEVE sur table inconnue (ensureSchema s'en sert pour detecter l'absence)
 *   - fetchTable rend le format colonnaire, toutes colonnes declarees presentes
 *   - _grist_Tables et _grist_Tables_column suivent les tables applicatives
 * Divergences connues avec grist.numerique.gouv.fr : voir docs/infra-de-test.md.
 */

const TABLES_META = ['_grist_Tables', '_grist_Tables_column'];

function createFakeGrist(documentInitial) {
    const doc = {};
    const refTable = {};       // tableId -> ref numerique
    const refColonne = {};     // tableId -> { colId -> ref numerique }
    let prochainRefTable = 1;
    let prochainRefColonne = 1;

    function declarerTable(tableId, colonnes, enregistrements) {
        doc[tableId] = { columns: {}, records: enregistrements || [] };
        refTable[tableId] = prochainRefTable++;
        refColonne[tableId] = {};
        for (const colId of Object.keys(colonnes || {})) declarerColonne(tableId, colId, colonnes[colId]);
    }

    function declarerColonne(tableId, colId, info) {
        doc[tableId].columns[colId] = Object.assign({ type: 'Any' }, info || {});
        refColonne[tableId][colId] = prochainRefColonne++;
    }

    for (const tableId of Object.keys(documentInitial || {})) {
        const t = documentInitial[tableId];
        declarerTable(tableId, t.columns, (t.records || []).map((r) => Object.assign({}, r)));
    }

    function versColonnaire(enregistrements, colIds) {
        const out = { id: enregistrements.map((r) => r.id) };
        for (const colId of colIds) {
            out[colId] = enregistrements.map((r) => (colId in r ? r[colId] : null));
        }
        return out;
    }

    function lignesMetaTables() {
        return Object.keys(doc).map((tableId) => ({ id: refTable[tableId], tableId: tableId }));
    }

    function lignesMetaColonnes() {
        const lignes = [];
        for (const tableId of Object.keys(doc)) {
            for (const colId of Object.keys(doc[tableId].columns)) {
                const info = doc[tableId].columns[colId];
                lignes.push({
                    id: refColonne[tableId][colId],
                    parentId: refTable[tableId],
                    colId: colId,
                    type: info.type,
                    widgetOptions: info.widgetOptions != null ? info.widgetOptions : '',
                    visibleCol: info.visibleCol != null ? info.visibleCol : 0
                });
            }
        }
        return lignes;
    }

    async function fetchTable(nom) {
        if (nom === '_grist_Tables') {
            return versColonnaire(lignesMetaTables(), ['tableId']);
        }
        if (nom === '_grist_Tables_column') {
            return versColonnaire(lignesMetaColonnes(), ['parentId', 'colId', 'type', 'widgetOptions', 'visibleCol']);
        }
        if (!doc[nom]) throw new Error('Table inconnue: ' + nom);
        return versColonnaire(doc[nom].records, Object.keys(doc[nom].columns));
    }

    async function listTables() {
        return Object.keys(doc).filter((t) => TABLES_META.indexOf(t) === -1);
    }

    return {
        docApi: { fetchTable: fetchTable, listTables: listTables },
        _doc: doc,
        _refTable: refTable,
        _refColonne: refColonne,
        _declarerTable: declarerTable,
        _declarerColonne: declarerColonne
    };
}

module.exports = { createFakeGrist };
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```
node --test tests/unit/fake-grist.test.js
```

Attendu : succès des 6 tests.

- [ ] **Étape 5 : commit, en attente d'accord**

```bash
git add tests/fake-grist.js tests/fixtures/documents.js tests/unit/fake-grist.test.js
git commit -m "test(taskflow): socle du simulacre Grist, lecture et metadonnees"
```

---

### Tâche 4 : actions utilisateur du simulacre

**Fichiers :**
- Modifier : `tests/fake-grist.js`
- Modifier : `tests/unit/fake-grist.test.js`

**Interfaces :**
- Produit :
  - `grist.docApi.applyUserActions(actions)` applique et journalise, rend `{ retValues: [...] }`.
  - Actions couvertes : `AddTable`, `AddColumn`, `ModifyColumn`, `SetDisplayFormula`,
    `AddRecord`, `BulkAddRecord`, `UpdateRecord`, `RemoveRecord`.
  - `grist._log` est le tableau des actions reçues, dans l'ordre.

- [ ] **Étape 1 : écrire le test qui échoue**

À ajouter en fin de `tests/unit/fake-grist.test.js` :

```js
test('AddRecord ajoute un enregistrement et attribue un identifiant', async () => {
    const grist = createFakeGrist(documentMinimal());
    const retour = await grist.docApi.applyUserActions([
        ['AddRecord', 'Tasks', null, { titre: 'Nouvelle', statut: 'todo' }]
    ]);
    assert.equal(retour.retValues[0], 2);
    const data = await grist.docApi.fetchTable('Tasks');
    assert.deepEqual(data.titre, ['Analyse', 'Nouvelle']);
});

test('UpdateRecord ne modifie que les champs fournis', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', 1, { statut: 'done' }]]);
    const data = await grist.docApi.fetchTable('Tasks');
    assert.deepEqual(data.statut, ['done']);
    assert.deepEqual(data.titre, ['Analyse']);
});

test('RemoveRecord retire l enregistrement', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.docApi.applyUserActions([['RemoveRecord', 'Tasks', 1]]);
    const data = await grist.docApi.fetchTable('Tasks');
    assert.deepEqual(data.id, []);
});

test('BulkAddRecord ajoute plusieurs enregistrements au format colonnaire', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.docApi.applyUserActions([
        ['BulkAddRecord', 'Team', [null, null], { nom: ['Claire', 'David'] }]
    ]);
    const data = await grist.docApi.fetchTable('Team');
    assert.deepEqual(data.nom, ['Alice', 'Bob', 'Claire', 'David']);
});

test('AddTable rend la table lisible et visible dans les metadonnees', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.docApi.applyUserActions([
        ['AddTable', 'Projects', [{ id: 'nom', type: 'Text' }, { id: 'couleur', type: 'Text' }]]
    ]);
    assert.deepEqual(await grist.docApi.fetchTable('Projects'), { id: [], nom: [], couleur: [] });
    const meta = await grist.docApi.fetchTable('_grist_Tables');
    assert.ok(meta.tableId.includes('Projects'));
});

test('AddColumn ajoute la colonne, valeur nulle sur les enregistrements existants', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.docApi.applyUserActions([['AddColumn', 'Tasks', 'charges', { type: 'Text' }]]);
    const data = await grist.docApi.fetchTable('Tasks');
    assert.deepEqual(data.charges, [null]);
});

test('ModifyColumn fusionne les proprietes de la colonne', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.docApi.applyUserActions([
        ['ModifyColumn', 'Tasks', 'statut', { widgetOptions: '{"choices":["a"]}' }]
    ]);
    const cols = await grist.docApi.fetchTable('_grist_Tables_column');
    const index = cols.colId.indexOf('statut');
    assert.equal(cols.widgetOptions[index], '{"choices":["a"]}');
    assert.equal(cols.type[index], 'Choice');
});

test('le journal conserve les actions dans l ordre', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', 1, { statut: 'done' }]]);
    await grist.docApi.applyUserActions([['RemoveRecord', 'Tasks', 1]]);
    assert.deepEqual(grist._log.map((a) => a[0]), ['UpdateRecord', 'RemoveRecord']);
});

test('une action sur une table inconnue leve', async () => {
    const grist = createFakeGrist(documentMinimal());
    await assert.rejects(
        () => grist.docApi.applyUserActions([['UpdateRecord', 'Absente', 1, {}]]),
        /Absente/
    );
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
node --test tests/unit/fake-grist.test.js
```

Attendu : échec, `grist.docApi.applyUserActions is not a function`.

- [ ] **Étape 3 : implémenter les actions**

Dans `tests/fake-grist.js`, insérer avant le `return` final :

```js
    const journal = [];
    let prochainId = {};
    for (const tableId of Object.keys(doc)) {
        prochainId[tableId] = doc[tableId].records.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    }

    function table(tableId) {
        if (!doc[tableId]) throw new Error('Table inconnue: ' + tableId);
        return doc[tableId];
    }

    function appliquer(action) {
        const type = action[0];

        if (type === 'AddTable') {
            const colonnes = {};
            for (const c of action[2] || []) colonnes[c.id] = { type: c.type || 'Any' };
            declarerTable(action[1], colonnes, []);
            prochainId[action[1]] = 1;
            return null;
        }
        if (type === 'AddColumn') {
            declarerColonne(action[1], action[2], action[3]);
            return null;
        }
        if (type === 'ModifyColumn') {
            const colonne = table(action[1]).columns[action[2]];
            if (!colonne) throw new Error('Colonne inconnue: ' + action[1] + '.' + action[2]);
            Object.assign(colonne, action[3] || {});
            return null;
        }
        if (type === 'SetDisplayFormula') {
            // Signature reelle : ['SetDisplayFormula', tableId, null, colRef, formule].
            // Aucun widget n'exploite l'effet, on se contente de journaliser.
            return null;
        }
        if (type === 'AddRecord') {
            const t = table(action[1]);
            const id = action[2] != null ? action[2] : prochainId[action[1]]++;
            t.records.push(Object.assign({ id: id }, action[3] || {}));
            return id;
        }
        if (type === 'BulkAddRecord') {
            const t = table(action[1]);
            const valeurs = action[3] || {};
            const colIds = Object.keys(valeurs);
            const n = colIds.length ? valeurs[colIds[0]].length : (action[2] || []).length;
            const ids = [];
            for (let i = 0; i < n; i++) {
                const rec = { id: prochainId[action[1]]++ };
                for (const colId of colIds) rec[colId] = valeurs[colId][i];
                t.records.push(rec);
                ids.push(rec.id);
            }
            return ids;
        }
        if (type === 'UpdateRecord') {
            const t = table(action[1]);
            const rec = t.records.find((r) => r.id === action[2]);
            if (!rec) throw new Error('Enregistrement inconnu: ' + action[1] + '#' + action[2]);
            Object.assign(rec, action[3] || {});
            return null;
        }
        if (type === 'RemoveRecord') {
            const t = table(action[1]);
            const index = t.records.findIndex((r) => r.id === action[2]);
            if (index === -1) throw new Error('Enregistrement inconnu: ' + action[1] + '#' + action[2]);
            t.records.splice(index, 1);
            return null;
        }
        throw new Error('Action non geree par le simulacre: ' + type);
    }

    async function applyUserActions(actions) {
        const retValues = [];
        for (const action of actions || []) {
            journal.push(action);
            retValues.push(appliquer(action));
        }
        return { retValues: retValues };
    }
```

Puis compléter le `return` :

```js
    return {
        docApi: { fetchTable: fetchTable, listTables: listTables, applyUserActions: applyUserActions },
        _doc: doc,
        _log: journal,
        _refTable: refTable,
        _refColonne: refColonne,
        _declarerTable: declarerTable,
        _declarerColonne: declarerColonne
    };
```

Note : `declarerTable` réinitialise `prochainId` pour la table créée. La déclaration de
`prochainId` doit donc précéder tout appel, ce qui est le cas, l'initialisation du document ayant
lieu avant.

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```
node --test tests/unit/fake-grist.test.js
```

Attendu : succès des 15 tests.

- [ ] **Étape 5 : commit, en attente d'accord**

```bash
git add tests/fake-grist.js tests/unit/fake-grist.test.js
git commit -m "test(taskflow): actions utilisateur du simulacre Grist"
```

---

### Tâche 5 : abonnements et réémission

**Fichiers :**
- Modifier : `tests/fake-grist.js`
- Modifier : `tests/unit/fake-grist.test.js`

**Interfaces :**
- Produit :
  - `grist.ready(options)` mémorise les options et déclenche une première émission `onRecords`.
  - `grist.onRecords(cb)`, `grist.onRecord(cb)`, `grist.onOptions(cb)`.
  - `grist.setOption(cle, valeur)`, `grist.widgetApi.getOptions()`, `grist.widgetApi.setOptions(o)`.
  - `grist.setSelectedRows(ids)`, `grist.setCursorPos(pos)` journalisent.
  - `grist._tableLiee` désigne la table émise par `onRecords`, `'Tasks'` par défaut.

- [ ] **Étape 1 : écrire le test qui échoue**

À ajouter en fin de `tests/unit/fake-grist.test.js` :

```js
test('ready declenche une premiere emission onRecords au format colonnaire', async () => {
    const grist = createFakeGrist(documentMinimal());
    const recus = [];
    grist.onRecords((data) => recus.push(data));
    await grist.ready({ requiredAccess: 'full' });
    assert.equal(recus.length, 1);
    assert.deepEqual(recus[0].titre, ['Analyse']);
});

test('onRecords est reemis apres une mutation de la table liee', async () => {
    const grist = createFakeGrist(documentMinimal());
    const recus = [];
    grist.onRecords((data) => recus.push(data));
    await grist.ready({ requiredAccess: 'full' });
    await grist.docApi.applyUserActions([['AddRecord', 'Tasks', null, { titre: 'Nouvelle' }]]);
    assert.equal(recus.length, 2);
    assert.deepEqual(recus[1].titre, ['Analyse', 'Nouvelle']);
});

test('onRecords n est pas reemis pour une mutation d une autre table', async () => {
    const grist = createFakeGrist(documentMinimal());
    const recus = [];
    grist.onRecords((data) => recus.push(data));
    await grist.ready({ requiredAccess: 'full' });
    await grist.docApi.applyUserActions([['UpdateRecord', 'Team', 1, { nom: 'Alice M' }]]);
    assert.equal(recus.length, 1);
});

test('setOption notifie onOptions et se relit par getOptions', async () => {
    const grist = createFakeGrist(documentMinimal());
    const recus = [];
    grist.onOptions((o) => recus.push(o));
    await grist.setOption('filters', { project: [3] });
    assert.deepEqual(recus[0], { filters: { project: [3] } });
    assert.deepEqual(await grist.widgetApi.getOptions(), { filters: { project: [3] } });
});

test('setSelectedRows et setCursorPos sont journalises', async () => {
    const grist = createFakeGrist(documentMinimal());
    await grist.setSelectedRows([4]);
    await grist.setCursorPos({ rowId: 4 });
    assert.deepEqual(grist._log.map((a) => a[0]), ['setSelectedRows', 'setCursorPos']);
});

test('la table liee est configurable', async () => {
    const grist = createFakeGrist(documentMinimal(), { tableLiee: 'Team' });
    const recus = [];
    grist.onRecords((data) => recus.push(data));
    await grist.ready({ requiredAccess: 'full' });
    assert.deepEqual(recus[0].nom, ['Alice', 'Bob']);
});
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

```
node --test tests/unit/fake-grist.test.js
```

Attendu : échec, `grist.onRecords is not a function`.

- [ ] **Étape 3 : implémenter les abonnements**

Changer la signature en tête de `tests/fake-grist.js` :

```js
function createFakeGrist(documentInitial, options) {
    const config = options || {};
    const tableLiee = config.tableLiee || 'Tasks';
```

Insérer avant le `return` final :

```js
    const abonnes = { records: [], record: [], options: [] };
    let optionsWidget = {};

    async function emettreRecords() {
        if (!doc[tableLiee]) return;
        const data = await fetchTable(tableLiee);
        for (const cb of abonnes.records) cb(data, {});
    }

    async function ready(optionsPret) {
        journal.push(['ready', optionsPret]);
        await emettreRecords();
    }

    function onRecords(cb) { abonnes.records.push(cb); }
    function onRecord(cb) { abonnes.record.push(cb); }
    function onOptions(cb) { abonnes.options.push(cb); }

    async function setOption(cle, valeur) {
        optionsWidget = Object.assign({}, optionsWidget, { [cle]: valeur });
        for (const cb of abonnes.options) cb(optionsWidget);
    }

    async function setOptions(nouvelles) {
        optionsWidget = Object.assign({}, optionsWidget, nouvelles || {});
        for (const cb of abonnes.options) cb(optionsWidget);
    }

    async function getOptions() { return optionsWidget; }

    async function setSelectedRows(ids) {
        journal.push(['setSelectedRows', ids]);
        for (const cb of abonnes.record) cb(doc[tableLiee].records.find((r) => r.id === ids[0]) || null);
    }

    async function setCursorPos(pos) { journal.push(['setCursorPos', pos]); }
```

Dans `applyUserActions`, après la boucle et avant le `return`, ajouter la réémission :

```js
        const tablesTouchees = (actions || []).map((a) => a[1]);
        if (tablesTouchees.indexOf(tableLiee) !== -1) await emettreRecords();
```

Compléter le `return` :

```js
    return {
        ready: ready,
        onRecords: onRecords,
        onRecord: onRecord,
        onOptions: onOptions,
        setOption: setOption,
        setSelectedRows: setSelectedRows,
        setCursorPos: setCursorPos,
        widgetApi: { getOptions: getOptions, setOptions: setOptions },
        docApi: { fetchTable: fetchTable, listTables: listTables, applyUserActions: applyUserActions },
        _doc: doc,
        _log: journal,
        _tableLiee: tableLiee,
        _refTable: refTable,
        _refColonne: refColonne,
        _declarerTable: declarerTable,
        _declarerColonne: declarerColonne
    };
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

```
node --test tests/unit/fake-grist.test.js
```

Attendu : succès des 21 tests.

- [ ] **Étape 5 : commit, en attente d'accord**

```bash
git add tests/fake-grist.js tests/unit/fake-grist.test.js
git commit -m "test(taskflow): abonnements et reemission du simulacre Grist"
```

---

### Tâche 6 : couvrir les fonctions du core couplées à Grist

**Fichiers :**
- Créer : `tests/unit/core-grist.test.js`

**Interfaces :**
- Consomme : `createFakeGrist` (tâches 3 à 5), l'export du core (tâche 1).

Ces trois fonctions reçoivent `grist` en premier paramètre. Le simulacre leur est passé
directement, sans injection.

- [ ] **Étape 1 : écrire le test qui échoue**

`tests/unit/core-grist.test.js` :

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/taskflow-core.js');
const { createFakeGrist } = require('../fake-grist.js');
const { documentMinimal } = require('../fixtures/documents.js');

test('loadStatusConfig lit les choix de la colonne Choice', async () => {
    const grist = createFakeGrist(documentMinimal());
    const cfg = await TF.loadStatusConfig(grist, 'Tasks', 'statut');
    assert.equal(cfg.source, 'choice');
    assert.deepEqual(cfg.values, ['todo', 'inprogress', 'review', 'done']);
    assert.equal(cfg.byValue.done.fillColor, '#10b981');
});

test('loadStatusConfig retombe sur les valeurs presentes si la colonne n a pas de choix', async () => {
    const grist = createFakeGrist({
        Tasks: { columns: { statut: { type: 'Text' } }, records: [{ id: 1, statut: 'ouvert' }] }
    });
    const cfg = await TF.loadStatusConfig(grist, 'Tasks', 'statut', ['ouvert', 'ferme', 'ouvert']);
    assert.equal(cfg.source, 'data');
    assert.deepEqual(cfg.values, ['ouvert', 'ferme']);
    assert.equal(cfg.terminalValue, 'ferme');
});

test('loadStatusConfig retombe sur les statuts par defaut sans choix ni donnees', async () => {
    const grist = createFakeGrist({
        Tasks: { columns: { statut: { type: 'Text' } }, records: [] }
    });
    const cfg = await TF.loadStatusConfig(grist, 'Tasks', 'statut');
    assert.equal(cfg.source, 'default');
    assert.equal(cfg.terminalValue, 'done');
});

test('loadStatusConfig ne jette pas si la table est absente', async () => {
    const grist = createFakeGrist(documentMinimal());
    const cfg = await TF.loadStatusConfig(grist, 'Absente', 'statut');
    assert.equal(cfg.source, 'default');
});

test('seedStatusChoices respecte une colonne deja configuree', async () => {
    const grist = createFakeGrist(documentMinimal());
    await TF.seedStatusChoices(grist, 'Tasks', 'statut', TF.DEFAULT_STATUSES);
    assert.equal(grist._log.length, 0);
});

test('seedStatusChoices seme les choix sur une colonne vierge', async () => {
    const grist = createFakeGrist({
        Tasks: { columns: { statut: { type: 'Choice' } }, records: [] }
    });
    await TF.seedStatusChoices(grist, 'Tasks', 'statut', TF.DEFAULT_STATUSES);

    const modif = grist._log.find((a) => a[0] === 'ModifyColumn');
    assert.ok(modif, 'une action ModifyColumn doit avoir ete emise');
    const opt = JSON.parse(modif[3].widgetOptions);
    assert.deepEqual(opt.choices, ['todo', 'inprogress', 'review', 'done']);
    assert.equal(opt.choiceOptions.done.fillColor, '#10b981');
});

test('setRefDisplayColumns pose la colonne visible sur une Ref', async () => {
    const grist = createFakeGrist({
        Tasks: { columns: { titre: { type: 'Text' }, projet: { type: 'Ref:Projects' } }, records: [] },
        Projects: { columns: { nom: { type: 'Text' } }, records: [] }
    });
    await TF.setRefDisplayColumns(grist, [{ table: 'Tasks', column: 'projet', visibleColId: 'nom' }]);

    const types = grist._log.map((a) => a[0]);
    assert.ok(types.includes('SetDisplayFormula'));
    const maj = grist._log.find((a) => a[0] === 'UpdateRecord' && a[1] === '_grist_Tables_column');
    assert.ok(maj, 'la colonne visible doit etre posee');
    assert.equal(maj[3].visibleCol, grist._refColonne.Projects.nom);
});

test('setRefDisplayColumns n emet rien si la colonne cible est absente', async () => {
    const grist = createFakeGrist({
        Tasks: { columns: { projet: { type: 'Ref:Projects' } }, records: [] },
        Projects: { columns: { autre: { type: 'Text' } }, records: [] }
    });
    await TF.setRefDisplayColumns(grist, [{ table: 'Tasks', column: 'projet', visibleColId: 'nom' }]);
    assert.equal(grist._log.length, 0);
});

test('setRefDisplayColumns n emet rien si la colonne n est pas une Ref', async () => {
    const grist = createFakeGrist({
        Tasks: { columns: { projet: { type: 'Text' } }, records: [] },
        Projects: { columns: { nom: { type: 'Text' } }, records: [] }
    });
    await TF.setRefDisplayColumns(grist, [{ table: 'Tasks', column: 'projet', visibleColId: 'nom' }]);
    assert.equal(grist._log.length, 0);
});
```

- [ ] **Étape 2 : lancer le test**

```
node --test tests/unit/core-grist.test.js
```

Attendu : succès. Un échec sur `setRefDisplayColumns` peut venir du fait que la mise à jour cible
la table de métadonnées `_grist_Tables_column`, que le simulacre ne traite pas comme une table
applicative dans `UpdateRecord`.

Si c'est le cas, ajouter dans `appliquer` de `tests/fake-grist.js`, en tête de la branche
`UpdateRecord` :

```js
        if (type === 'UpdateRecord' && action[1] === '_grist_Tables_column') {
            // Les widgets posent visibleCol par une mise a jour de la table de metadonnees.
            for (const tableId of Object.keys(refColonne)) {
                for (const colId of Object.keys(refColonne[tableId])) {
                    if (refColonne[tableId][colId] === action[2]) {
                        Object.assign(doc[tableId].columns[colId], action[3] || {});
                        return null;
                    }
                }
            }
            return null;
        }
```

Puis relancer.

- [ ] **Étape 3 : lancer la suite complète**

```
npm test
```

Attendu : succès de tous les fichiers de `tests/unit/`.

- [ ] **Étape 4 : commit, en attente d'accord**

```bash
git add tests/unit/core-grist.test.js tests/fake-grist.js
git commit -m "test(taskflow): couvre les fonctions du core couplees a Grist"
```

---

### Tâche 7 : intégration continue

**Fichiers :**
- Créer : `.github/workflows/tests.yml`

**Interfaces :**
- Consomme : `npm test` (tâche 1), `npm run check:taskflow` (existant).

- [ ] **Étape 1 : écrire le workflow**

`.github/workflows/tests.yml` :

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  tests:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Tests unitaires
        run: npm test

      - name: Synchronisation du core inline
        run: npm run check:taskflow
```

Aucune étape d'installation : la phase 0 n'introduit aucune dépendance.

- [ ] **Étape 2 : vérifier localement les deux commandes du workflow**

```
npm test
npm run check:taskflow
```

Attendu : les deux sortent en code 0. Si `check:taskflow` signale une désynchronisation, lancer
`npm run build:taskflow` et vérifier que le seul écart porte sur la ligne d'export ajoutée en
tâche 1.

- [ ] **Étape 3 : commit, en attente d'accord**

```bash
git add .github/workflows/tests.yml
git commit -m "ci: execute les tests unitaires et verifie la synchronisation du core"
```

---

## Vérification de fin de phase

- [ ] `npm test` passe.
- [ ] `npm run check:taskflow` passe.
- [ ] `projects/tasks_app/gantt.html` ouvert dans un navigateur affiche le mode démo sans erreur
      en console. C'est la vérification que la ligne d'export est bien inerte côté navigateur.
- [ ] Le seul fichier de production modifié est `core/taskflow-core.js`, plus la propagation
      mécanique de la ligne d'export dans les 6 widgets par le build.

## Suite

La phase 1 introduit Playwright et les tests de niveau 2, puis corrige #8/#9 et #4/#11
test-first. Elle fera l'objet de son propre plan.
