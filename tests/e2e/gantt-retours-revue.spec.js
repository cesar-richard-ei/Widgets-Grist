'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Retours de la revue projet du 14/08/2026 : largeur de la colonne, second intervenant sur la
// ligne, jalon proposé à la création, type modifiable tant que la fiche est neuve, responsable
// nommé au survol.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, responsable: { type: 'Ref:Team' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true, responsable: 2 }] },
    Team: {
        columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } },
        records: [
            { id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' },
            { id: 2, nom: 'Bruno Klein', actif: true, couleur: '#10b981' },
            { id: 3, nom: 'Chloe Roux', actif: true, couleur: '#f59e0b' },
            { id: 4, nom: 'David Sarr', actif: true, couleur: '#ef4444' }
        ]
    },
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
        records: [
            { id: 1, titre: 'Equipe complete', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', Responsable: 2, assignees: ['L', 1, 2, 3, 4] },
            { id: 2, titre: 'Sans responsable', chantier: 1, dateDebut: j(-3), dateEcheance: j(5), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 1, 3, 4] },
            { id: 3, titre: 'Duo', chantier: 1, dateDebut: j(-2), dateEcheance: j(4), statut: 'todo', type: 'tache', priorite: '2', Responsable: 1, assignees: ['L', 1, 3] }
        ]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await page.locator('#taskList .task-row', { hasText: 'Duo' }).waitFor();
}

const pastilles = (page, titre) => page.locator('#taskList .task-row', { hasText: titre }).locator('.task-avatar').allTextContents();

test('la colonne des taches s ouvre a 310px', async ({ page }) => {
    await ouvrirGantt(page);

    const largeur = await page.locator('#taskList').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    expect(largeur).toBe(310);
});

test('la ligne montre le responsable et un contributeur avant de compter', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Equipe complete')).toEqual(['BK', 'AM', '+2']);
});

test('sans responsable, deux contributeurs sont montres', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Sans responsable')).toEqual(['AM', 'CR', '+1']);
});

test('a deux intervenants, aucun compteur', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Duo')).toEqual(['AM', 'CR']);
});

test('le menu de creation propose aussi le jalon', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#btnAjouter').click();

    await expect(page.locator('#menuAjout button')).toHaveText(['Tâche', 'Chantier', 'Jalon']);
});

test('creer un jalon depuis le menu ouvre une fiche de jalon', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Jalon' }).click();

    await expect(page.locator('#panel .type-pill.selected')).toHaveText('◆ Jalon');
});

test('sur une fiche neuve, le type reste modifiable', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#btnAjouter').click();
    await page.locator('#menuAjout button', { hasText: 'Tâche' }).click();
    await page.locator('#taskTitle').fill('Bascule en chantier');
    await page.locator('#panel .type-pill', { hasText: 'Chantier' }).click();

    await expect(page.locator('#panel .type-pill.selected')).toHaveText('Chantier');
    await expect(page.locator('#taskTitle')).toHaveValue('Bascule en chantier');
});

test('sur une fiche enregistree, le type reste fige', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#taskList .task-row', { hasText: 'Equipe complete' }).click();
    await page.locator('#panel .type-pill', { hasText: 'Chantier' }).click();

    await expect(page.locator('#panel .type-pill.selected')).toHaveText('Tâche');
});

test('la bulle de survol nomme le responsable', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#taskList .task-row', { hasText: 'Equipe complete' }).hover();

    const bulle = page.locator('#tooltip');
    await expect(bulle).toBeVisible();
    await expect(bulle).toContainText('Responsable');
    await expect(bulle).toContainText('Bruno Klein');
});
