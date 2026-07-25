'use strict';

const { test, expect } = require('./harness.js');

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
