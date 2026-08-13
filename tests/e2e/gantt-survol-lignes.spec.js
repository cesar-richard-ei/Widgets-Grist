'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Demande de la frame « UI de la vue GANTT » : « Au survol, afficher le meme bloc noir qu'au
// survol des barres sur le gantt », pour les lignes de la colonne de gauche.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice', actif: true, couleur: '#3e5de7' }] },
    Tasks: {
        columns: {
            parentTask: { type: 'Ref:Tasks' },
            titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
            priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
            assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
            tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
            couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [{ id: 1, titre: 'Cadrage technique', dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1', projet: 1, assignees: ['L', 1] }]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

test('survoler une ligne montre le meme bloc que sur les barres', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#taskList .task-row', { hasText: 'Cadrage technique' }).hover();

    const bulle = page.locator('#tooltip');
    await expect(bulle).toHaveClass(/visible/);
    await expect(bulle).toContainText('Cadrage technique');
});

test('la bulle disparait quand on quitte la ligne', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#taskList .task-row', { hasText: 'Cadrage technique' }).hover();
    await expect(page.locator('#tooltip')).toHaveClass(/visible/);

    await page.mouse.move(5, 5);

    await expect(page.locator('#tooltip')).not.toHaveClass(/visible/);
});
