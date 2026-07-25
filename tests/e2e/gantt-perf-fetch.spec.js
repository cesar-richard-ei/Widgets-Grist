'use strict';

const path = require('path');
const { test, expect } = require('./harness.js');
const { documentComplet } = require('../fixtures/documents.js');

// À l'ouverture, ensureSchema + loadAllData relisaient les tables de métadonnées une fois
// par helper (seedStatusChoices, setRefDisplayColumns, ensureUntiedLabels, loadStatusConfig).
// Chaque fetchTable est un aller-retour réseau : on ne veut lire les métadonnées qu'une fois.
function countFetch(page, tableName) {
    return page.evaluate((t) => window.grist._fetches.filter(n => n === t).length, tableName);
}

test('les tables de metadonnees ne sont lues qu une fois a l ouverture', async ({ gantt }) => {
    expect(await countFetch(gantt, '_grist_Tables')).toBeLessThanOrEqual(1);
    expect(await countFetch(gantt, '_grist_Tables_column')).toBeLessThanOrEqual(1);
});

test('sur un doc deja peuple, les tables de donnees ne sont lues qu une fois', async ({ page }) => {
    await page.route('**/grist-plugin-api.js', (r) => r.abort());
    await page.addInitScript({ path: path.join(__dirname, '..', 'fake-grist.js') });
    await page.addInitScript((doc) => { window.grist = window.createFakeGrist(doc); }, documentComplet());
    await page.goto('/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    expect(await countFetch(page, 'Tasks')).toBeLessThanOrEqual(1);
    expect(await countFetch(page, 'Team')).toBeLessThanOrEqual(1);
    expect(await countFetch(page, 'Projects')).toBeLessThanOrEqual(1);
});
