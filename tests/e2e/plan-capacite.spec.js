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

// Le Gantt diffuse ses filtres en tableaux, y compris vides. Le Plan lisait `project` comme une
// valeur simple : un tableau vide n'est ni null ni chaîne vide, le filtre s'appliquait et comparait
// chaque projet à String([]), soit ''. Plus aucune tâche ne passait, et le plan se vidait.
const AVEC_CHARGE = (doc) => {
    const copie = JSON.parse(JSON.stringify(doc));
    const t = copie.Tasks.records[0];
    t.charges = JSON.stringify([{ teamId: 1, heures: 12 }]);
    t.dateDebut = D.j(0);
    t.dateEcheance = D.j(10);
    t.statut = 'todo';
    return copie;
};

async function ouvrirPlanAvecOptions(page, doc, optionsSection) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript(([d, o]) => { window.grist = window.createFakeGrist(d, { options: o }); }, [doc, optionsSection]);
    await page.goto('http://localhost:3001/tasks_app/plan.html');
    await page.setContent('<iframe id="f" style="width:1200px;height:700px;border:0" src="http://localhost:3001/tasks_app/plan.html?shell=1"></iframe>');
    await expect(page.frameLocator('#f').locator('#gridwrap table.grid, #gridwrap .empty')).toBeVisible();
}

test('des filtres partages vides ne vident pas le plan', async ({ page }) => {
    const filtres = { project: [], priority: [], assignee: [], domaine: [] };
    await ouvrirPlanAvecOptions(page, AVEC_CHARGE(D.documentCible()), { filters: filtres });

    await expect(page.frameLocator('#f').locator('#gridwrap table.grid')).toBeVisible();
});

test('un filtre projet partage reste appliqué', async ({ page }) => {
    // Le projet 2 ne porte aucune tâche chargée : le plan doit rester vide.
    await ouvrirPlanAvecOptions(page, AVEC_CHARGE(D.documentCible()), { filters: { project: [2] } });

    await expect(page.frameLocator('#f').locator('#gridwrap .empty')).toBeVisible();
});

// Un plan vide sans explication a coûté plusieurs allers-retours : il dit maintenant ce qu'il a lu.
test('le plan vide dit ce qu il a lu', async ({ page }) => {
    const doc = D.documentCible();
    doc.Tasks.records.forEach((t) => { t.charges = ''; });
    await ouvrirPlanAvecOptions(page, doc, {});

    const vide = page.frameLocator('#f').locator('#gridwrap .empty');
    await expect(vide).toContainText('tâches lues');
    await expect(vide).toContainText('0 avec charge');
});
