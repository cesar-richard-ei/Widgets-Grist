'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Le filtre porte sur la colonne `Responsable`, celle qui dit qui pilote la ligne. Être assigné à
// une tâche n'y suffit pas : le Gantt se lit par pilote, pas par participant.

const filtrer = (page, id) => page.evaluate((v) => toggleFilter('responsable', v), id);
const retenues = (page) => page.evaluate(() => getFilteredTasks().map((t) => t.titre).sort());

test('seules les lignes pilotees par la personne sont retenues', async ({ page }) => {
    await D.ouvrirGantt(page);

    // Chloé pilote le chantier « Guides utilisateurs » et n'est qu'assignée sur « Guide de prise en main ».
    await filtrer(page, 3);

    expect(await retenues(page)).toEqual(['Guides utilisateurs']);
});

test('un chantier reste visible quand on filtre sur son responsable', async ({ page }) => {
    await D.ouvrirGantt(page);

    await filtrer(page, 2);

    expect(await retenues(page)).toEqual(['Cadrage des outils', 'Socle technique']);
});

test('le menu propose les membres actifs et compte les choix', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.locator('#filtreResponsable .filter-btn').click();
    await page.waitForSelector('#menuResponsable.open');

    const noms = await page.locator('#menuResponsable .filter-option[data-filtre="responsable"]').allTextContents();
    expect(noms.map((n) => n.trim()).sort()).toEqual(['Alice Martin', 'Bruno Klein', 'Chloé Roux', 'David Sarr']);

    await page.locator('#menuResponsable .filter-option', { hasText: 'Bruno Klein' }).click();

    await expect(page.locator('#filtreResponsable .filter-count')).toHaveText('1');
    await expect(page.locator('#filtreResponsable .filter-btn')).toHaveClass(/has-filter/);
});

test('le filtre pose se retrouve en pastille, et s en retire', async ({ page }) => {
    await D.ouvrirGantt(page);
    await filtrer(page, 4);

    const pastille = page.locator('#filterChips .fc-chip', { hasText: 'David Sarr' });
    await expect(pastille).toHaveCount(1);

    await pastille.locator('.fc-x').click();

    await expect(page.locator('#filterChips .fc-chip')).toHaveCount(0);
    expect(await page.evaluate(() => filters.responsable)).toEqual([]);
});

test('un responsable absent des effectifs est ignore a l application', async ({ page }) => {
    await D.ouvrirGantt(page);

    await page.evaluate(() => { filters.responsable = [99999]; });

    expect(await page.evaluate(() => effectiveFilters().responsable)).toEqual([]);
});
