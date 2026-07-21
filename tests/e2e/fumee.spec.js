'use strict';

const { test, expect } = require('./harness.js');

test('le widget construit son schema et affiche les taches semees', async ({ gantt }) => {
    // seedData() cree 10 taches (7 racines + 3 sous-taches WBS de "API backend"), mais l'arbre
    // demarre replie : seules les taches sans parent sont rendues tant que l'utilisateur ne
    // deplie pas la ligne parente. Le nombre de lignes visibles a l'ouverture est donc 7, pas 10.
    await expect(gantt.locator('#taskList .task-row')).toHaveCount(7);

    const tables = await gantt.evaluate(() => window.grist.docApi.listTables());
    expect(tables.sort()).toEqual(['Projects', 'Tasks', 'Team']);
});

test('le mode demonstration ne se declenche pas quand des taches existent', async ({ gantt }) => {
    // Le repli automatique du widget se declenche a 2800 ms si aucune tache n'est chargee.
    await gantt.waitForTimeout(3200);
    await expect(gantt.locator('.demo-badge')).toHaveCount(0);
});
