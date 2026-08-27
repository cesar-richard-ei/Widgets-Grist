'use strict';

const path = require('path');
const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Sur le document du métier, `Team.capaciteHebdo` est une formule. L'écriture partait quand même,
// Grist la refusait, et le `catch` vide n'en disait rien : la saisie disparaissait au rendu suivant.

function avecCapacite(doc, calculee) {
    const copie = JSON.parse(JSON.stringify(doc));
    copie.Team.columns.capaciteHebdo = calculee ? { type: 'Numeric', isFormula: true } : { type: 'Numeric' };
    copie.Team.records.forEach((m) => { m.capaciteHebdo = 35; });
    return copie;
}

// Le Plan bascule sur les données d'exemple hors iframe : il est chargé dans un cadre, comme dans
// Grist.
async function ouvrirPlan(page, doc) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); }, doc);
    await page.goto('http://localhost:3001/tasks_app/plan.html');
    await page.setContent('<iframe id="f" style="width:100%;height:700px;border:0" src="http://localhost:3001/tasks_app/plan.html?shell=1"></iframe>');
    // Le jeu de référence ne porte pas de charge datée : le Plan rend son état vide, ce qui suffit,
    // le panneau ressource ne dépend pas de la grille.
    await expect(page.frameLocator('#f').locator('#gridwrap table.grid, #gridwrap .empty')).toBeVisible();
}

const cadre = (page) => page.frame({ url: /plan\.html\?shell=1/ });
const champCapacite = (page) => page.frameLocator('#f').locator('.capedit input');

test('la capacite ne se saisit pas quand sa colonne est calculee', async ({ page }) => {
    await ouvrirPlan(page, avecCapacite(D.documentCible(), true));
    await cadre(page).evaluate(() => openResource('1'));

    await expect(champCapacite(page)).toBeDisabled();
});

test('la capacite se saisit quand sa colonne est ordinaire', async ({ page }) => {
    await ouvrirPlan(page, avecCapacite(D.documentCible(), false));
    await cadre(page).evaluate(() => openResource('1'));

    await expect(champCapacite(page)).toBeEnabled();
});
