'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Ce que la barre d'outils du Gantt propose, et ce qu'elle ne propose plus.

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

test('la barre d outils garde la navigation, les filtres et la création', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('.header-center .btn', { hasText: "Aujourd'hui" })).toHaveCount(1);
    await expect(page.locator('#colorSelect')).toHaveCount(1);
    await expect(page.locator('#filterGantt')).toHaveCount(1);
    await expect(page.locator('#btnAjouter')).toHaveCount(1);
});
