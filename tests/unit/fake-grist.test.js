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

test('UpdateRecord sur _grist_Tables_column pose visibleCol via refColonne', async () => {
    const grist = createFakeGrist(documentMinimal());
    const refStatut = grist._refColonne.Tasks.statut;
    await grist.docApi.applyUserActions([
        ['UpdateRecord', '_grist_Tables_column', refStatut, { visibleCol: 42 }]
    ]);
    const cols = await grist.docApi.fetchTable('_grist_Tables_column');
    const index = cols.colId.indexOf('statut');
    assert.equal(cols.visibleCol[index], 42);
});

test('UpdateRecord sur _grist_Tables_column leve sur une reference inconnue', async () => {
    const grist = createFakeGrist(documentMinimal());
    await assert.rejects(
        () => grist.docApi.applyUserActions([['UpdateRecord', '_grist_Tables_column', 9999, { visibleCol: 1 }]]),
        /9999/
    );
});

test('AddRecord a identifiant explicite fait avancer prochainId et refuse les collisions', async () => {
    const grist = createFakeGrist(documentMinimal());
    const premier = await grist.docApi.applyUserActions([['AddRecord', 'Tasks', 5, { titre: 'Cinq' }]]);
    assert.equal(premier.retValues[0], 5);
    const suivant = await grist.docApi.applyUserActions([['AddRecord', 'Tasks', null, { titre: 'Suivante' }]]);
    assert.equal(suivant.retValues[0], 6);
    await assert.rejects(
        () => grist.docApi.applyUserActions([['AddRecord', 'Tasks', 6, { titre: 'Collision' }]]),
        /6/
    );
});

test('_declarerTable initialise prochainId, AddRecord ne produit pas d identifiant NaN', async () => {
    const grist = createFakeGrist(documentMinimal());
    grist._declarerTable('Nouvelle', { titre: { type: 'Text' } }, []);
    const premier = await grist.docApi.applyUserActions([
        ['AddRecord', 'Nouvelle', null, { titre: 'Un' }]
    ]);
    const second = await grist.docApi.applyUserActions([
        ['AddRecord', 'Nouvelle', null, { titre: 'Deux' }]
    ]);
    assert.ok(Number.isInteger(premier.retValues[0]));
    assert.ok(Number.isInteger(second.retValues[0]));
    assert.notEqual(premier.retValues[0], second.retValues[0]);
});

test('un lot d actions echoue entierement si une action leve en cours de route', async () => {
    const grist = createFakeGrist(documentMinimal());
    await assert.rejects(
        () => grist.docApi.applyUserActions([
            ['UpdateRecord', 'Tasks', 1, { statut: 'done' }],
            ['UpdateRecord', 'Tasks', 999, { statut: 'done' }]
        ]),
        /999/
    );
    const data = await grist.docApi.fetchTable('Tasks');
    assert.deepEqual(data.statut, ['todo']);
    assert.deepEqual(grist._log, []);
});

test('BulkAddRecord honore les identifiants explicites presents dans le lot', async () => {
    const grist = createFakeGrist(documentMinimal());
    const retour = await grist.docApi.applyUserActions([
        ['BulkAddRecord', 'Team', [10, null], { nom: ['Claire', 'David'] }]
    ]);
    assert.deepEqual(retour.retValues[0], [10, 11]);
    const data = await grist.docApi.fetchTable('Team');
    assert.deepEqual(data.id, [1, 2, 10, 11]);
});

test('AddColumn sur une table inconnue leve le message homogene des autres actions', async () => {
    const grist = createFakeGrist(documentMinimal());
    await assert.rejects(
        () => grist.docApi.applyUserActions([['AddColumn', 'Absente', 'x', { type: 'Text' }]]),
        /Table inconnue: Absente/
    );
});

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

test('onRecords n est pas reemis quand un lot echoue', async () => {
    const grist = createFakeGrist(documentMinimal());
    const recus = [];
    grist.onRecords((data) => recus.push(data));
    await grist.ready({ requiredAccess: 'full' });
    await assert.rejects(
        () => grist.docApi.applyUserActions([
            ['AddRecord', 'Tasks', null, { titre: 'Nouvelle' }],
            ['UpdateRecord', 'Tasks', 999, { statut: 'done' }]
        ]),
        /999/
    );
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

test('setSelectedRows ne leve pas quand la table liee est absente', async () => {
    const grist = createFakeGrist(documentMinimal(), { tableLiee: 'Projects' });
    grist.onRecord(() => {});
    await assert.doesNotReject(() => grist.setSelectedRows([1]));
    assert.deepEqual(grist._log.map((a) => a[0]), ['setSelectedRows']);
});

test('onOptions recoit un second argument signalant une notification du widget lui meme', async () => {
    const grist = createFakeGrist(documentMinimal());
    const recus = [];
    grist.onOptions((o, interaction) => recus.push(interaction));
    await grist.setOption('filters', { project: [3] });
    assert.deepEqual(recus[0], { source: 'self' });
});

test('setOptions notifie egalement onOptions avec source self', async () => {
    const grist = createFakeGrist(documentMinimal());
    const recus = [];
    grist.onOptions((o, interaction) => recus.push(interaction));
    await grist.widgetApi.setOptions({ dash: { colonnes: 4 } });
    assert.deepEqual(recus[0], { source: 'self' });
});

test('la table liee est configurable', async () => {
    const grist = createFakeGrist(documentMinimal(), { tableLiee: 'Team' });
    const recus = [];
    grist.onRecords((data) => recus.push(data));
    await grist.ready({ requiredAccess: 'full' });
    assert.deepEqual(recus[0].nom, ['Alice', 'Bob']);
});
