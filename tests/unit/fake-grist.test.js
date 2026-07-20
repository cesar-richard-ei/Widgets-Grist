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
