'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Demande du document « Propositions d'ameliorations UX » du board, formulee par deux
// utilisateurs : pouvoir dupliquer une tache ou un jalon existant, quand plusieurs se
// ressemblent.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice', actif: true, couleur: '#3e5de7' }] },
    Chantiers: {
        columns: {
            Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' },
            Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' },
            Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' }
        },
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
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [
            { id: 1, titre: 'Atelier de cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 1], estimationH: 8, description: 'Preparer le cadrage' },
            { id: 2, titre: 'Livraison MVP', chantier: 1, dateDebut: j(10), dateEcheance: j(10), statut: 'todo', type: 'jalon', priorite: '1' }
        ]
    }
};

async function ouvrirLigne(page, titre) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await page.locator('#taskList .task-row', { hasText: titre }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

const lignesTasks = (page) => page.evaluate(async () => {
    const t = await window.grist.docApi.fetchTable('Tasks');
    return t.id.map((id, i) => ({ id: id, titre: t.titre[i], type: t.type[i], chantier: t.chantier[i], estimationH: t.estimationH[i], description: t.description[i] }));
});

test('dupliquer une tache reprend ses champs et son rattachement', async ({ page }) => {
    await ouvrirLigne(page, 'Atelier de cadrage');

    await page.locator('#panel button', { hasText: 'Dupliquer' }).click();

    await expect.poll(async () => (await lignesTasks(page)).length).toBe(3);
    const copie = (await lignesTasks(page)).find(t => t.id === 3);
    expect(copie.titre).toBe('Atelier de cadrage (copie)');
    expect(copie.chantier).toBe(1);
    expect(copie.estimationH).toBe(8);
    expect(copie.description).toBe('Preparer le cadrage');
});

test('la copie s ouvre dans le volet pour etre renommee', async ({ page }) => {
    await ouvrirLigne(page, 'Atelier de cadrage');

    await page.locator('#panel button', { hasText: 'Dupliquer' }).click();

    await expect(page.locator('#taskTitle')).toHaveValue('Atelier de cadrage (copie)');
});

test('un jalon se duplique en jalon', async ({ page }) => {
    await ouvrirLigne(page, 'Livraison MVP');

    await page.locator('#panel button', { hasText: 'Dupliquer' }).click();

    await expect.poll(async () => (await lignesTasks(page)).length).toBe(3);
    expect((await lignesTasks(page)).find(t => t.id === 3).type).toBe('jalon');
});

test('un chantier ne propose pas la duplication', async ({ page }) => {
    await ouvrirLigne(page, 'Atelier de cadrage');
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).click();

    await expect(page.locator('#panel button', { hasText: 'Dupliquer' })).toHaveCount(0);
});
