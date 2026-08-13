'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');
const JOUR = 86400;
const LE_2_AOUT = Math.floor(Date.UTC(2026, 7, 2) / 1000);

// Chantiers de deux projets qui s'entrelacent dans le temps : trie par date, l'ordre naturel
// serait Portail, Mobile, Portail, Mobile. Ils doivent sortir groupes par projet.
const DOC = {
    Tasks: {
        columns: {
            titre: { type: 'Text' }, statut: { type: 'Choice' }, priorite: { type: 'Int' },
            dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, projet: { type: 'Ref:Projects' },
            assignees: { type: 'RefList:Team' }, parentTask: { type: 'Ref:Tasks' }
        },
        records: [
            { id: 1, titre: 'Portail — cadrage', statut: 'todo', priorite: 1, dateDebut: LE_2_AOUT, dateEcheance: LE_2_AOUT + 5 * JOUR, projet: 1 },
            { id: 2, titre: 'Mobile — maquettes', statut: 'todo', priorite: 2, dateDebut: LE_2_AOUT + 1 * JOUR, dateEcheance: LE_2_AOUT + 6 * JOUR, projet: 2 },
            { id: 3, titre: 'Portail — dev', statut: 'todo', priorite: 1, dateDebut: LE_2_AOUT + 2 * JOUR, dateEcheance: LE_2_AOUT + 9 * JOUR, projet: 1 },
            { id: 4, titre: 'Mobile — dev', statut: 'todo', priorite: 3, dateDebut: LE_2_AOUT + 3 * JOUR, dateEcheance: LE_2_AOUT + 12 * JOUR, projet: 2 },
            { id: 5, titre: 'Sans projet', statut: 'todo', priorite: 4, dateDebut: LE_2_AOUT + 4 * JOUR, dateEcheance: LE_2_AOUT + 8 * JOUR, projet: 0 }
        ]
    },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Paul', actif: true, couleur: '#3e5de7' }] },
    Projects: {
        columns: { nom: { type: 'Text' }, couleur: { type: 'Text' } },
        records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7' }, { id: 2, nom: 'Mobile', couleur: '#10b981' }]
    }
};

const test2 = test.extend({
    gantt: async ({ page }, use) => {
        await page.route('**/grist-plugin-api.js', (route) => route.abort());
        await page.addInitScript({ path: CHEMIN_SIMULACRE });
        await page.addInitScript((doc) => { window.grist = window.createFakeGrist(doc); }, DOC);
        await page.goto('http://localhost:3001/tasks_app/gantt.html');
        await page.waitForSelector('#taskList .task-row');
        await use(page);
    }
});

// Suite des projets dans l'ordre d'affichage, en ne gardant que les racines.
const suiteDesProjets = (page) => page.$$eval('#taskList .task-row[data-projet]', (lignes) =>
    lignes.filter((l) => l.dataset.depth === '0').map((l) => l.dataset.projet));

function estGroupee(suite) {
    const vus = new Set();
    let precedent = null;
    for (const p of suite) {
        if (p !== precedent && vus.has(p)) return false;   // on revient a un projet deja quitte
        vus.add(p);
        precedent = p;
    }
    return true;
}

for (const tri of ['date', 'priority']) {
    test2('tri ' + tri + ' : les chantiers d un meme projet restent groupes', async ({ gantt }) => {
        await gantt.selectOption('#sortSelect', tri);

        const suite = await suiteDesProjets(gantt);
        expect(suite.length).toBe(5);
        expect(estGroupee(suite), 'ordre obtenu : ' + suite.join(', ')).toBe(true);
    });
}

test2('le tri reste applique a l interieur de chaque projet', async ({ gantt }) => {
    await gantt.selectOption('#sortSelect', 'date');

    const titres = await gantt.$$eval('#taskList .task-row', (l) => l.map((x) => x.textContent));
    const rang = (t) => titres.findIndex((x) => x.includes(t));
    expect(rang('Portail — cadrage')).toBeLessThan(rang('Portail — dev'));
    expect(rang('Mobile — maquettes')).toBeLessThan(rang('Mobile — dev'));
});

test2('un changement de projet est marque dans la liste et dans la timeline', async ({ gantt }) => {
    const bandeaux = await gantt.locator('#taskList .groupe-projet').count();
    expect(bandeaux).toBe(3);   // Portail, Mobile, sans projet
    expect(await gantt.locator('#timelineGrid .grid-row.piste-groupe').count()).toBe(3);
});
