'use strict';

const path = require('path');
const base = require('@playwright/test');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le document de depart est vide : ensureSchema() puis seedData() du widget construisent
// eux-memes les tables et les donnees. Rien a maintenir cote fixture, et le chemin reel
// d'initialisation est exerce a chaque test.
const test = base.test.extend({
    gantt: async ({ page }, use) => {
        // La vraie API Grist definirait window.grist et ecraserait le simulacre.
        await page.route('**/grist-plugin-api.js', (route) => route.abort());

        await page.addInitScript({ path: CHEMIN_SIMULACRE });
        await page.addInitScript(() => { window.grist = window.createFakeGrist({}); });

        await page.goto('/tasks_app/gantt.html');
        await page.waitForSelector('#taskList .task-row');
        await use(page);
    }
});

// Ouvre la premiere ligne visible et renvoie son data-id : la liste est triee par
// sortTasks() et la hierarchie WBS replie certaines lignes, donc l'identifiant de la
// premiere ligne affichee ne correspond pas forcement au premier enregistrement de la table.
async function ouvrirPremiereTache(page) {
    const premiereLigne = page.locator('#taskList .task-row').first();
    const id = Number(await premiereLigne.getAttribute('data-id'));
    await premiereLigne.click();
    await base.expect(page.locator('#panel')).toHaveClass(/open/);
    return id;
}

// Ouvre la ligne visible a l'indice donne (0-based) et renvoie son data-id.
async function ouvrirTacheAIndice(page, indice) {
    const ligne = page.locator('#taskList .task-row').nth(indice);
    const id = Number(await ligne.getAttribute('data-id'));
    await ligne.click();
    await base.expect(page.locator('#panel')).toHaveClass(/open/);
    return id;
}

// Lit une colonne de la table Tasks pour un identifiant donne, via le simulacre.
async function lireChampTache(page, id, colonne) {
    return page.evaluate(async ({ taskId, col }) => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t[col][t.id.indexOf(taskId)];
    }, { taskId: id, col: colonne });
}

module.exports = {
    test: test,
    expect: base.expect,
    ouvrirPremiereTache: ouvrirPremiereTache,
    ouvrirTacheAIndice: ouvrirTacheAIndice,
    lireChampTache: lireChampTache
};
