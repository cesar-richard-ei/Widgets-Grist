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
