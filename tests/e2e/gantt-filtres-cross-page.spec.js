'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Les filtres sont partagés entre les vues d'un même document : ils vivent en localStorage sous une
// clé qui porte l'identifiant du document, et non dans les options de la section.

test('un filtre pose est persiste en localStorage sous la cle du document', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.evaluate(() => toggleFilter('priority', 1));
    const raw = await page.evaluate(() => localStorage.getItem('taskflow_gantt_filters:' + filterDocId));
    expect(JSON.parse(raw).priority).toEqual([1]);
});

test('au rechargement, le filtre est restaure depuis localStorage', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.evaluate(() => toggleFilter('priority', 1));
    await page.reload();
    await page.waitForSelector('#taskList .task-row');
    expect(await page.evaluate(() => filters.priority)).toEqual([1]);
});

test('un id projet absent des donnees est ignore a l application, la priorite reste', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.evaluate(() => { filters.project = [99999]; filters.priority = [1]; });
    const eff = await page.evaluate(() => effectiveFilters());
    expect(eff.project).toEqual([]);
    expect(eff.priority).toEqual([1]);
});

// Le stockage local fait foi : la section peut amorcer ses options avec d'autres valeurs, elles ne
// doivent pas écraser le filtre déjà posé par l'utilisateur.
test('les options de la section n écrasent pas le filtre stocké', async ({ page }) => {
    await D.ouvrirGantt(page, null, {
        reglages: { 'taskflow_gantt_filters:fake-doc': JSON.stringify({ project: [], assignee: [], priority: [1] }) },
        optionsSection: { filters: { project: [], assignee: [], priority: [2] } }
    });

    expect(await page.evaluate(() => filters.priority)).toEqual([1]);
});

test('un evenement storage sur la cle re-hydrate les filtres', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.evaluate(() => {
        localStorage.setItem('taskflow_gantt_filters:' + filterDocId, JSON.stringify({ project: [], assignee: [], priority: [3] }));
        window.dispatchEvent(new StorageEvent('storage', { key: filterStorageKey() }));
    });
    expect(await page.evaluate(() => filters.priority)).toEqual([3]);
});

// La coche d'une option ne venait que du clic natif sur la case elle-même : cliquer le libellé
// posait bien le filtre, sans cocher. Le menu ne retrouvait son état qu'au prochain rechargement
// des données, d'où une coche absente pendant que le filtre restait actif.
const ouvrirMenuFiltres = async (page) => {
    await page.locator('#filterGantt .filter-btn').click();
    await page.waitForSelector('#filterAllMenu.open');
};

const optionProjet = (page, nom) => page.locator('#filterAllMenu .filter-option', { hasText: nom });

test('cliquer le libelle d une option la coche', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrirMenuFiltres(page);

    await optionProjet(page, 'Datalab').click();

    await expect(optionProjet(page, 'Datalab').locator('input')).toBeChecked();
    expect(await page.evaluate(() => filters.project)).toEqual([2]);
});

test('la coche survit a une fermeture et un rendu du gantt', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrirMenuFiltres(page);
    await optionProjet(page, 'Datalab').click();

    await page.locator('#filterGantt .filter-btn').click();
    await expect(page.locator('#filterAllMenu')).not.toHaveClass(/open/);
    await page.evaluate(() => render());
    await ouvrirMenuFiltres(page);

    await expect(optionProjet(page, 'Datalab').locator('input')).toBeChecked();
});

test('decocher retire le filtre et la coche', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrirMenuFiltres(page);
    await optionProjet(page, 'Datalab').click();

    await optionProjet(page, 'Datalab').click();

    await expect(optionProjet(page, 'Datalab').locator('input')).not.toBeChecked();
    expect(await page.evaluate(() => filters.project)).toEqual([]);
});
