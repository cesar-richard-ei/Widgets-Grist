'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const COLONNES_TASKS = {
    chantier: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' },
    titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
    priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
    assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
    tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
    couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
    charges: { type: 'Text' }, dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
};

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, responsable: { type: 'Ref:Team' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true, responsable: 2 }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }, { id: 2, nom: 'Bruno Klein', actif: true, couleur: '#10b981' }] },
    Chantiers: {
        columns: { Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' }, Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' }, Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' } },
        records: [{ id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] }]
    },
    Tasks: {
        columns: COLONNES_TASKS,
        records: [{ id: 1, titre: 'Atelier de cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', Responsable: 1, assignees: ['L', 1, 2] }]
    }
};

async function ouvrirGantt(page, doc) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, doc || DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

test('la couleur par responsable est proposee en premier et appliquee par defaut', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#colorSelect')).toHaveValue('responsable');
    const premiere = await page.locator('#colorSelect option').first().getAttribute('value');
    expect(premiere).toBe('responsable');
});

test('sans colonne Responsable, le mode par projet reprend la main', async ({ page }) => {
    const colonnes = Object.assign({}, COLONNES_TASKS);
    delete colonnes.Responsable;
    const doc = JSON.parse(JSON.stringify(DOC));
    doc.Tasks.columns = colonnes;
    delete doc.Tasks.records[0].Responsable;

    await ouvrirGantt(page, doc);

    await expect(page.locator('#colorSelect')).toHaveValue('project');
    await expect(page.locator('#colorSelect option[value="responsable"]')).toHaveCount(0);
});

test('la colonne des taches s ouvre a 310px', async ({ page }) => {
    await ouvrirGantt(page);

    const largeur = await page.locator('#taskList').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(largeur).toBe(310);
});

test('les poignees affichent le curseur de redimensionnement horizontal', async ({ page }) => {
    await ouvrirGantt(page);

    for (const id of ['poigneeTaskList', 'poigneePanel']) {
        const curseur = await page.locator('#' + id).evaluate((el) => getComputedStyle(el).cursor);
        expect(curseur).toBe('ew-resize');
    }
});
