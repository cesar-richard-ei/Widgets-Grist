'use strict';

const { test, expect } = require('./harness.js');

// Delier colId <-> label permet de renommer les libelles des colonnes dans Grist
// sans casser le widget, qui lit et ecrit tout par colId. ensureSchema doit poser
// untieColIdFromLabel sur les colonnes des trois tables, docs neufs comme existants.
test('apres init, les colonnes du widget sont deliees de leur libelle', async ({ gantt }) => {
    const toutesDeliees = await gantt.evaluate(() => {
        const attendues = { Tasks: ['titre', 'statut', 'projet', 'parentTask'], Team: ['nom'], Projects: ['nom'] };
        return Object.entries(attendues).every(([table, cols]) =>
            cols.every(c => window.grist._doc[table].columns[c].untieColIdFromLabel === true));
    });
    expect(toutesDeliees).toBe(true);
});
