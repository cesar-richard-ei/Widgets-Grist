'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

function docFiche() {
    return {
        Projects: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Refonte', actif: true }, { id: 2, nom: 'Autre projet', actif: true }] },
        Team: { columns: { nom: { type: 'Text' } }, records: [{ id: 1, nom: 'A' }] },
        Tasks: {
            columns: {
                titre: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
                priorite: { type: 'Choice' }, statut: { type: 'Choice' }, projet: { type: 'Ref:Projects' },
                parentTask: { type: 'Ref:Tasks' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' }, progression: { type: 'Numeric' }
            },
            records: [
                { id: 10, titre: 'Chantier A', projet: 1, dateDebut: 1750000000, dateEcheance: 1752000000, priorite: '1', type: 'tache' },
                { id: 11, titre: 'Sous 1', projet: 1, parentTask: 10, dateDebut: 1750000000, dateEcheance: 1751000000, priorite: '2', type: 'tache' },
                { id: 12, titre: 'Sous 2', projet: 1, parentTask: 10, dateDebut: 1751000000, dateEcheance: 1752000000, priorite: '2', type: 'tache' },
                { id: 20, titre: 'Autre tache', projet: 1, dateDebut: 1750000000, dateEcheance: 1751500000, priorite: '3', type: 'tache' },
                { id: 30, titre: 'Hors projet', projet: 2, dateDebut: 1750000000, dateEcheance: 1751000000, priorite: '3', type: 'tache' }
            ]
        }
    };
}

async function ouvrirFiche(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: path.join(__dirname, '..', 'fake-grist.js') });
    await page.addInitScript((doc) => { window.grist = window.createFakeGrist(doc); }, docFiche());
    await page.goto('/tasks_app/gantt-fiche.html');
    await page.waitForFunction(() => typeof tasks !== 'undefined' && tasks.length > 0);
}

test('scope projet : toutes les taches rattachees au projet', async ({ page }) => {
    await ouvrirFiche(page);
    await page.evaluate(() => { scopeRecord = { id: 1, nom: 'Refonte', actif: true }; render(); });
    const ids = await page.evaluate(() => getScopedTasks().map(t => t.id).sort((a, b) => a - b));
    expect(ids).toEqual([10, 11, 12, 20]); // pas la tache 30 (projet 2)
});

test('scope chantier : la tache parente et son sous-arbre', async ({ page }) => {
    await ouvrirFiche(page);
    await page.evaluate(() => { scopeRecord = { id: 10, titre: 'Chantier A', parentTask: null }; render(); });
    const ids = await page.evaluate(() => getScopedTasks().map(t => t.id).sort((a, b) => a - b));
    expect(ids).toEqual([10, 11, 12]);
});

test('sans selection, un etat vide est affiche', async ({ page }) => {
    await ouvrirFiche(page);
    await expect(page.locator('#ficheEmpty')).toBeVisible();
});

test('read-only : aucune ecriture Grist emise', async ({ page }) => {
    await ouvrirFiche(page);
    await page.evaluate(() => { scopeRecord = { id: 1, nom: 'Refonte' }; render(); });
    const writes = await page.evaluate(() => window.grist._log.filter(a => a[0] === 'applyUserActions').length);
    expect(writes).toBe(0);
});

test('scope projet : les barres rendues correspondent au perimetre', async ({ page }) => {
    await ouvrirFiche(page);
    await page.evaluate(() => { scopeRecord = { id: 1, nom: 'Refonte' }; render(); });
    // 4 taches datees dans le projet, aucune n'est un jalon → 4 barres
    await expect(page.locator('#timelineGrid .gantt-bar')).toHaveCount(4);
});
