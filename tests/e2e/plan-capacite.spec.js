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
    await ouvrirPlanAvecOptions(page, AVEC_CHARGE(D.documentCible()), {});
    await page.frameLocator('#f').locator('#gridwrap table.grid').waitFor();

    await page.frame({ url: /plan\.html\?shell=1/ })
        .evaluate(() => window.grist.setOption('filters', { project: [], priority: [], assignee: [], domaine: [] }));

    await expect(page.frameLocator('#f').locator('#gridwrap table.grid')).toBeVisible();
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

// Le filtre diffusé par le Gantt s'appliquait sans rien afficher : un plan vide restait
// inexplicable, et rien ne permettait de lever le filtre depuis le Plan.
const diffuserFiltre = (page, filtres) => page.frame({ url: /plan\.html\?shell=1/ })
    .evaluate((f) => window.grist.setOption('filters', f), filtres);

test('le plan annonce le filtre herite du gantt', async ({ page }) => {
    await ouvrirPlanAvecOptions(page, AVEC_CHARGE(D.documentCible()), {});
    await page.frameLocator('#f').locator('#gridwrap table.grid').waitFor();

    await diffuserFiltre(page, { project: [2] });

    await expect(page.frameLocator('#f').locator('#alerts')).toContainText('Datalab');
});

test('le filtre herite se retire depuis le plan', async ({ page }) => {
    await ouvrirPlanAvecOptions(page, AVEC_CHARGE(D.documentCible()), {});
    await page.frameLocator('#f').locator('#gridwrap table.grid').waitFor();
    await diffuserFiltre(page, { project: [2] });
    await expect(page.frameLocator('#f').locator('#gridwrap .empty')).toBeVisible();

    await page.frameLocator('#f').locator('#alerts .fc-x').click();

    await expect(page.frameLocator('#f').locator('#gridwrap table.grid')).toBeVisible();
});

// Grist rejoue les options de la section à l'ouverture. Le Gantt les ignore, son localStorage
// faisant foi : un filtre laissé là par une session passée n'y apparaît plus. Le Plan les
// appliquait, et subissait donc un filtre que plus personne ne voyait ni ne pouvait retirer.
test('un filtre laisse dans les options de section ne filtre plus le plan', async ({ page }) => {
    await ouvrirPlanAvecOptions(page, AVEC_CHARGE(D.documentCible()), { filters: { project: [2] } });

    await expect(page.frameLocator('#f').locator('#gridwrap table.grid')).toBeVisible();
    await expect(page.frameLocator('#f').locator('#alerts')).not.toContainText('filtre du Gantt');
});

test('un filtre diffuse pendant la session s applique', async ({ page }) => {
    await ouvrirPlanAvecOptions(page, AVEC_CHARGE(D.documentCible()), {});

    await page.frameLocator('#f').locator('#gridwrap table.grid').waitFor();
    await page.frame({ url: /plan\.html\?shell=1/ }).evaluate(() => window.grist.setOption('filters', { project: [2] }));

    await expect(page.frameLocator('#f').locator('#alerts')).toContainText('Datalab');
    await expect(page.frameLocator('#f').locator('#gridwrap .empty')).toBeVisible();
});
