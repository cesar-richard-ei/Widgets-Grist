'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Retour de revue : les libellés de mois doivent être centrés dans la hauteur de leur case, et
// écrits en toutes lettres quand la case est assez large.

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
        records: [{ id: 1, titre: 'Cadrage', projet: 1, dateDebut: j(-10), dateEcheance: j(40), statut: 'todo', type: 'tache', priorite: '2' }]
    }
};

async function ouvrirGantt(page, vue) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    if (vue) {
        await page.locator('.view-controls .btn[data-view="' + vue + '"]').click();
        await page.waitForSelector('.view-controls .btn[data-view="' + vue + '"].active');
    }
    await page.waitForSelector('#monthsHeader .month-cell');
}

test('les libelles de mois sont centres dans la hauteur de leur case', async ({ page }) => {
    await ouvrirGantt(page);

    const ecarts = await page.evaluate(() => {
        const cases = Array.from(document.querySelectorAll('#monthsHeader .month-cell')).filter(c => c.textContent.trim());
        return cases.map((c) => {
            const boite = c.getBoundingClientRect();
            const plage = document.createRange();
            plage.selectNodeContents(c);
            const texte = plage.getBoundingClientRect();
            const hautDessus = texte.top - boite.top;
            const basDessous = boite.bottom - texte.bottom;
            return Math.abs(hautDessus - basDessous);
        });
    });
    expect(ecarts.length).toBeGreaterThan(0);
    for (const ecart of ecarts) expect(ecart).toBeLessThanOrEqual(1.5);
});

// Le libellé est comparé aux constantes du widget : le test ne dépend pas du mois courant.
const libellesDeMois = (page) => page.evaluate(() => {
    return Array.from(document.querySelectorAll('#monthsHeader .month-cell'))
        .filter(c => c.textContent.trim())
        .map(c => {
            const t = c.textContent.trim();
            const nom = t.includes(' · ') ? t.split(' · ')[1] : t;
            return { texte: nom, largeur: c.getBoundingClientRect().width, complet: MONTHS.includes(nom), abrege: MONTHS_SHORT.includes(nom) };
        });
});

test('sur des cases larges, le mois s ecrit en toutes lettres', async ({ page }) => {
    await ouvrirGantt(page, 'semester');

    const libelles = await libellesDeMois(page);
    const larges = libelles.filter(l => l.largeur > 100);
    expect(larges.length).toBeGreaterThan(2);
    for (const l of larges) expect(l.complet, l.texte).toBe(true);
    // Une case partielle en bord de plage reste lisible plutôt que tronquée.
    for (const l of libelles) expect(l.complet || l.abrege, l.texte).toBe(true);
});

test('sur des cases etroites, le mois reste abrege', async ({ page }) => {
    await ouvrirGantt(page, 'year');

    const abreges = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('#daysHeader .day-cell'))
            .map(c => c.textContent.trim())
            .filter(Boolean)
            .every(t => MONTHS_SHORT.includes(t));
    });
    expect(abreges).toBe(true);
});
