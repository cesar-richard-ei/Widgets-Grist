'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Depuis que les chantiers et les bandeaux de projet occupent des lignes, le compteur de la
// colonne annonçait leur total sous le libelle « Taches ». Il ne compte que les taches.

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
        records: [
            { id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] },
            { id: 2, Nom_du_chantier: 'Documentation', Date_debut: j(-2), Date_fin: j(12), Projets: ['L', 1] }
        ]
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
            { id: 1, titre: 'Cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1' },
            { id: 2, titre: 'Recette', chantier: 1, dateDebut: j(0), dateEcheance: j(4), statut: 'todo', type: 'tache', priorite: '2' },
            { id: 3, titre: 'Rediger le guide', chantier: 2, dateDebut: j(2), dateEcheance: j(9), statut: 'todo', type: 'tache', priorite: '3' }
        ]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

const compteur = (page) => page.locator('#taskCount').innerText();

test('le compteur ne compte ni les bandeaux ni les chantiers', async ({ page }) => {
    await ouvrirGantt(page);

    // A l'ouverture, la colonne montre 1 bandeau et 2 chantiers, aucune tache dépliée.
    expect(await compteur(page)).toBe('0');
});

test('le compteur suit les taches rendues visibles', async ({ page }) => {
    await ouvrirGantt(page);

    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await expect(page.locator('#taskList .task-row', { hasText: 'Cadrage' })).toBeVisible();

    expect(await compteur(page)).toBe('2');

    await page.locator('#taskList .task-row', { hasText: 'Documentation' }).locator('.tree-chevron').click();
    await expect(page.locator('#taskList .task-row', { hasText: 'Rediger le guide' })).toBeVisible();

    expect(await compteur(page)).toBe('3');
});
