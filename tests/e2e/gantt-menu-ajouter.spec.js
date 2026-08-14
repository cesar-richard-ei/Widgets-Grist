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
    charges: { type: 'Text' }, dateCloture: { type: 'Date' }
};

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }] },
    Chantiers: {
        columns: { Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' }, Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' }, Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' } },
        records: [{ id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] }]
    },
    Tasks: {
        columns: COLONNES_TASKS,
        records: [{ id: 1, titre: 'Atelier de cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2' }]
    }
};

function sansChantiers() {
    const doc = JSON.parse(JSON.stringify(DOC));
    delete doc.Chantiers;
    delete doc.Tasks.columns.chantier;
    delete doc.Tasks.records[0].chantier;
    return doc;
}

async function ouvrirGantt(page, doc) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, doc || DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

test('un seul bouton de creation, nomme Ajouter', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#btnAjouter')).toHaveText(/Ajouter/);
    await expect(page.locator('#btnAjouterChantier')).toHaveCount(0);
});

test('le bouton propose la tache, le chantier et le jalon', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#menuAjout')).toBeHidden();
    await page.locator('#btnAjouter').click();

    await expect(page.locator('#menuAjout')).toBeVisible();
    await expect(page.locator('#menuAjout button')).toHaveText(['Tâche', 'Chantier', 'Jalon']);
});

test('choisir Chantier ouvre une fiche de chantier', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Chantier' }).click();

    await expect(page.locator('#panel')).toHaveClass(/open/);
    await expect(page.locator('#panel .type-pill.selected')).toHaveText('Chantier');
    await expect(page.locator('#menuAjout')).toBeHidden();
});

test('choisir Tache ouvre une fiche de tache', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Tâche' }).click();

    await expect(page.locator('#panel')).toHaveClass(/open/);
    await expect(page.locator('#panel .type-pill.selected')).toHaveText('Tâche');
});

test('un clic a cote referme le menu', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#btnAjouter').click();
    await expect(page.locator('#menuAjout')).toBeVisible();
    await page.locator('#taskList').click({ position: { x: 10, y: 300 } });

    await expect(page.locator('#menuAjout')).toBeHidden();
});

test('sans table Chantiers, le bouton cree directement une tache', async ({ page }) => {
    await ouvrirGantt(page, sansChantiers());

    await page.locator('#btnAjouter').click();

    await expect(page.locator('#menuAjout')).toBeHidden();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    await expect(page.locator('#panel .type-pill.selected')).toHaveText('Tâche');
});

test('la fiche propose la tache, le chantier puis le jalon, et plus la reunion', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await page.locator('#taskList .task-row', { hasText: 'Atelier de cadrage' }).click();

    await expect(page.locator('#panel .type-pill')).toHaveText(['Tâche', 'Chantier', '◆ Jalon']);
    await expect(page.locator('#panel .type-pill', { hasText: 'Réunion' })).toHaveCount(0);
});
