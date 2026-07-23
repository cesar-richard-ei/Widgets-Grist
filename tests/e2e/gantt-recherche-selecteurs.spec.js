'use strict';

const { test, expect, ouvrirPremiereTache } = require('./harness.js');

// Vérifie le champ de recherche d'un dropdown : focus a l'ouverture, filtrage en direct,
// message "aucun resultat", et retour a l'etat complet quand on efface.
async function verifierRecherche(gantt, selectId) {
    const search = gantt.locator('#' + selectId + ' .multi-select-search');
    await expect(search).toBeFocused();

    const options = gantt.locator('#' + selectId + ' .multi-select-option');
    const total = await options.count();
    expect(total).toBeGreaterThan(0);
    const premier = (await options.first().innerText()).trim();

    await search.fill('zzintrouvablezz');
    await expect(gantt.locator('#' + selectId + ' .multi-select-option:visible')).toHaveCount(0);
    await expect(gantt.locator('#' + selectId + ' .multi-select-noresult')).toBeVisible();

    await search.fill(premier.slice(0, 3));
    const visibles = await gantt.locator('#' + selectId + ' .multi-select-option:visible').count();
    expect(visibles).toBeGreaterThan(0);
    expect(visibles).toBeLessThanOrEqual(total);

    await search.fill('');
    await expect(gantt.locator('#' + selectId + ' .multi-select-option:visible')).toHaveCount(total);
}

test('recherche dans le selecteur de personnes (assignes)', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.click('#assigneesSelect .addbtn');
    await verifierRecherche(gantt, 'assigneesSelect');
});

test('recherche dans le selecteur de dependances', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.click('#depsSelect .multi-select-trigger');
    await verifierRecherche(gantt, 'depsSelect');
});

test('recherche dans le selecteur de tache racine (parent)', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    // La premiere ligne visible est une tache racine (sans parent) : le selecteur parent s'affiche.
    await gantt.click('#parentSelect .addbtn');
    await verifierRecherche(gantt, 'parentSelect');
});
