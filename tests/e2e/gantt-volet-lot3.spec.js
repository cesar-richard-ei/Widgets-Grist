'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Document « UI du volet tâche », troisième lot : l'ordre des blocs, tel que le cadrage le fixe.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'IA et codage', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }] },
    Chantiers: {
        columns: { Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' }, Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' }, Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' } },
        records: [{ id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] }]
    },
    Tasks: {
        columns: {
            chantier: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' },
            titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
            priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
            assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
            tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
            couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
        },
        records: [{ id: 1, titre: 'Cadrage des outils', chantier: 1, projet: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 1] }]
    }
};

async function ouvrirFiche(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await page.locator('#taskList .task-row', { hasText: 'Cadrage des outils' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

// Libellés des blocs dans leur ordre d'apparition **à l'écran** : le DOM ne suffit pas, un ordre
// CSS pourrait le contredire.
const blocs = (page) => page.evaluate(() => {
    return Array.from(document.querySelectorAll('#panelContent .panel-section-title, #panelContent .props-list > .prop-row > .prop-label'))
        .map(el => ({ texte: el.textContent.trim(), haut: el.getBoundingClientRect().top }))
        .sort((a, b) => a.haut - b.haut)
        .map(x => x.texte);
});

test('les blocs suivent l ordre du cadrage', async ({ page }) => {
    await ouvrirFiche(page);

    expect(await blocs(page)).toEqual([
        'Description',
        'Dates',
        'Statut',
        'Progression',
        'Responsable',
        'Contributeurs',
        'Projet',
        'Chantier',
        'Priorité',
        'Sous-tâches (hiérarchie)',
        'Parent',
        'Dépendances',
        'Tags',
        'Temps & charge'
    ]);
});

test('le titre reste au-dessus de tout', async ({ page }) => {
    await ouvrirFiche(page);

    const ordre = await page.evaluate(() => {
        const titre = document.getElementById('taskTitle').getBoundingClientRect().top;
        const premier = document.querySelector('#panelContent .panel-section-title').getBoundingClientRect().top;
        return titre < premier;
    });
    expect(ordre).toBe(true);
});

test('un chantier garde un volet lisible', async ({ page }) => {
    await ouvrirFiche(page);
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).click();

    const vus = await blocs(page);
    expect(vus).toContain('Description');
    expect(vus).toContain('Dates');
    expect(vus).not.toContain('Priorité');
    expect(vus).not.toContain('Chantier');
});
