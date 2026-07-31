'use strict';

const { test, expect } = require('./harness.js');
const { ouvrirPremiereTache, lireChampTache } = require('./harness.js');

// Un <input type="date"> emet un change a chaque chiffre tape dans l'annee : saisir 2027
// passe par 0002, 0020 puis 0202. Ces dates intermediaires ne doivent pas atteindre la
// timeline, sinon la plage s'etend sur des milliers d'annees et le widget se fige.
const ETAPES = ['0002-07-31', '0020-07-31', '0202-07-31'];

const nbCellules = (page) => page.locator('#timelineGrid .grid-row').first().locator('.grid-cell').count();

test("saisir l'annee au clavier ne fige pas la timeline", async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    const champ = gantt.locator('#panel input[type="date"]').first();
    const avant = await nbCellules(gantt);

    for (const etape of ETAPES) {
        await champ.fill(etape);
        expect(await nbCellules(gantt)).toBe(avant);
    }

    // Le widget repond toujours : la liste des taches est intacte et cliquable.
    await expect(gantt.locator('#taskList .task-row').first()).toBeVisible();
});

test("l'annee complete est bien enregistree", async ({ gantt }) => {
    const id = await ouvrirPremiereTache(gantt);
    const champ = gantt.locator('#panel input[type="date"]').first();

    // Date anterieure a l'echeance de la tache : au-dela, la sauvegarde est refusee.
    for (const etape of ETAPES) await champ.fill(etape);
    await champ.fill('2026-07-06');

    await expect.poll(() => lireChampTache(gantt, id, 'dateDebut'))
        .toBe(Math.floor(Date.UTC(2026, 6, 6) / 1000));
});

test("les dates intermediaires ne sont pas ecrites dans Grist", async ({ gantt }) => {
    const id = await ouvrirPremiereTache(gantt);
    const initiale = await lireChampTache(gantt, id, 'dateDebut');
    const champ = gantt.locator('#panel input[type="date"]').first();

    await champ.fill(ETAPES[0]);

    expect(await lireChampTache(gantt, id, 'dateDebut')).toBe(initiale);
});
