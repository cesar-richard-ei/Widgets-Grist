'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// La bulle de survol tirait son fond de la couleur du texte, qui s'inverse avec le thème, tout en
// gardant un texte blanc écrit en dur : en thème sombre elle devenait un aplat clair illisible.

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
        records: [{ id: 1, titre: 'Creation d une page de suivi des projets de pilotage', projet: 1, dateDebut: j(0), dateEcheance: j(20), statut: 'todo', type: 'tache', priorite: '3' }]
    }
};

async function survoler(page, theme) {
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row').first().hover();
    await expect(page.locator('#tooltip')).toHaveClass(/visible/);
}

// Contraste du texte de la bulle sur son propre fond, titre et lignes de détail.
const contrastes = (page) => page.evaluate(() => {
    const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b); };
    const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const bulle = document.getElementById('tooltip');
    const fond = getComputedStyle(bulle).backgroundColor;
    const titre = getComputedStyle(bulle.querySelector('.tooltip-title')).color;
    const detail = getComputedStyle(bulle.querySelector('.tooltip-row span')).color;
    return { titre: ratio(titre, fond), detail: ratio(detail, fond) };
});

for (const theme of ['light', 'dark']) {
    test('la bulle de survol reste lisible en theme ' + theme, async ({ page }) => {
        await survoler(page, theme);

        const { titre, detail } = await contrastes(page);
        expect(titre).toBeGreaterThanOrEqual(4.5);
        expect(detail).toBeGreaterThanOrEqual(4.5);
    });
}
