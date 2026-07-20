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
    // Verifie l'effet sur le document et non seulement l'action emise.
    assert.equal(grist._doc.Tasks.columns.projet.visibleCol, grist._refColonne.Projects.nom);
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
