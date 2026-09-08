'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Ce que la barre d'outils du Gantt propose, et dans quel ordre.

test('la barre d outils ne propose ni tri, ni ajustement de la vue, ni export', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#sortSelect')).toHaveCount(0);
    await expect(page.locator('.header-center .btn', { hasText: 'Ajuster' })).toHaveCount(0);
    await expect(page.locator('#moreDropdown')).toHaveCount(0);
});

test('les vues temporelles vont du mois à l année, sans la semaine', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('.view-controls .btn')).toHaveText(['Mois', 'Trim', '6M', 'An']);
});

// Les flèches encadrent la période affichée, pas le bouton du jour : c'est la période qu'elles
// déplacent.
test('la gauche de la barre porte le jour, puis la periode entre ses fleches', async ({ page }) => {
    await D.ouvrirGantt(page);

    const gauche = await page.locator('.header-left > *').evaluateAll(
        (els) => els.map((e) => e.id || e.textContent.trim()));

    expect(gauche).toEqual(['badgeVersion', "Aujourd'hui", '◀', 'currentPeriod', '▶']);
});

test('la droite de la barre porte les trois filtres, la couleur puis l ajout', async ({ page }) => {
    await D.ouvrirGantt(page);

    const droite = await page.locator('.header-right > *').evaluateAll((els) => els.map((e) => e.id));

    expect(droite).toEqual(['filtreProjet', 'filtreDomaine', 'filtreResponsable', 'zoneCouleur', 'zoneAjout']);
});

test('le dropdown unique de filtres a laisse la place a trois menus independants', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#filterGantt')).toHaveCount(0);
    await expect(page.locator('#filterAllMenu')).toHaveCount(0);
    await expect(page.locator('.header-right .filter-btn')).toHaveText(['Projet', 'Domaine', 'Responsable']);
});

test('ouvrir un menu de filtre referme le precedent', async ({ page }) => {
    await D.ouvrirGantt(page);

    await page.locator('#filtreProjet .filter-btn').click();
    await expect(page.locator('#menuProjet')).toHaveClass(/open/);

    await page.locator('#filtreDomaine .filter-btn').click();

    await expect(page.locator('#menuProjet')).not.toHaveClass(/open/);
    await expect(page.locator('#menuDomaine')).toHaveClass(/open/);
});

test('la priorite n est plus un filtre du gantt', async ({ page }) => {
    await D.ouvrirGantt(page);

    expect(await page.evaluate(() => Object.keys(filters).sort())).toEqual(['domaine', 'project', 'responsable']);
    await expect(page.locator('.filter-option[data-filtre="priority"]')).toHaveCount(0);
});
