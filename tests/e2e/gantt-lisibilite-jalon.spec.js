'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le nom d'un jalon s'écrit à côté de son losange, par-dessus la grille et parfois par-dessus une
// barre : sa lisibilité ne doit pas dépendre de ce qui se trouve derrière.

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
        records: [
            { id: 1, titre: 'Plateforme APIA prête', projet: 1, dateDebut: j(10), dateEcheance: j(10), statut: 'todo', type: 'jalon', priorite: '1' },
            { id: 2, titre: 'Internet V2', projet: 1, dateDebut: j(0), dateEcheance: j(30), statut: 'todo', type: 'tache', priorite: '2' }
        ]
    }
};

async function ouvrirGantt(page, theme) {
    await page.emulateMedia({ colorScheme: theme });
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#timelineGrid .gantt-milestone');
}

const lisibilite = (page, selecteur) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b); };
    const s = getComputedStyle(el);
    const a = lum(s.color), b = lum(s.backgroundColor);
    return { opaque: !/rgba\([^)]*,\s*0?(\.\d+)?\)/.test(s.backgroundColor), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
}, selecteur);

for (const theme of ['light', 'dark']) {
    test('le nom du jalon reste lisible en theme ' + theme, async ({ page }) => {
        await ouvrirGantt(page, theme);

        const { opaque, ratio } = await lisibilite(page, '.gantt-milestone .milestone-label');
        expect(opaque).toBe(true);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
}

test('le losange garde sa couleur de priorite', async ({ page }) => {
    await ouvrirGantt(page, 'dark');

    const fond = await page.locator('.gantt-milestone .milestone-diamond').evaluate((el) => el.style.background);
    expect(fond).not.toBe('');
});
