'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }] },
    Tasks: {
        columns: {
            parentTask: { type: 'Ref:Tasks' }, titre: { type: 'Text' }, description: { type: 'Text' },
            dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, priorite: { type: 'Choice' },
            statut: { type: 'Choice' }, progression: { type: 'Numeric' }, assignees: { type: 'RefList:Team' },
            type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' }, tags: { type: 'ChoiceList' },
            estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, couleur: { type: 'Text' },
            subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' }, charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [{ id: 1, titre: 'Atelier de cadrage', projet: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2' }]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

// Une seule ligne : les trois blocs se chevauchent verticalement, quel que soit leur alignement.
const surUneSeuleLigne = (page) => page.evaluate(() => {
    const boites = ['.header-left', '.header-center', '.header-right'].map(s => document.querySelector(s).getBoundingClientRect());
    return boites.every(b => b.top < boites[0].bottom && b.bottom > boites[0].top);
});

test('en ecran etroit, la barre tient sur une seule ligne', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 700 });
    await ouvrirGantt(page);

    expect(await surUneSeuleLigne(page)).toBe(true);
});

// Le logo et le nom de la vue ne servent à rien dans Grist : la section porte déjà son titre, et
// chaque widget est inséré seul dans sa page.
test('le logo et le nom de la vue ont disparu de la barre', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await ouvrirGantt(page);

    await expect(page.locator('.header h1')).toHaveCount(0);
    await expect(page.locator('.header svg').first()).toBeVisible();
});
