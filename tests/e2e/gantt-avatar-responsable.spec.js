'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: {
        columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } },
        records: [
            { id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' },
            { id: 2, nom: 'Bruno Klein', actif: true, couleur: '#10b981' },
            { id: 3, nom: 'Chloe Roux', actif: true, couleur: '#f59e0b' },
            { id: 4, nom: 'David Sarr', actif: true, couleur: '#ef4444' }
        ]
    },
    Tasks: {
        columns: {
            parentTask: { type: 'Ref:Tasks' }, titre: { type: 'Text' }, description: { type: 'Text' },
            dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, priorite: { type: 'Choice' },
            statut: { type: 'Choice' }, progression: { type: 'Numeric' }, assignees: { type: 'RefList:Team' },
            type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' }, tags: { type: 'ChoiceList' },
            estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, couleur: { type: 'Text' },
            subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' }, charges: { type: 'Text' },
            dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
        },
        records: [
            { id: 1, titre: 'Responsable assigne', projet: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', Responsable: 2, assignees: ['L', 1, 2, 3] },
            { id: 2, titre: 'Responsable hors equipe projet', projet: 1, dateDebut: j(-3), dateEcheance: j(5), statut: 'todo', type: 'tache', priorite: '2', Responsable: 4, assignees: ['L', 1, 2, 3] },
            { id: 3, titre: 'Sans responsable', projet: 1, dateDebut: j(-2), dateEcheance: j(4), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 1, 2, 3] },
            { id: 4, titre: 'Un seul intervenant', projet: 1, dateDebut: j(-1), dateEcheance: j(3), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 3] },
            { id: 5, titre: 'Personne', projet: 1, dateDebut: j(0), dateEcheance: j(2), statut: 'todo', type: 'tache', priorite: '2' }
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

const pastilles = (page, titre) => page.locator('#taskList .task-row', { hasText: titre }).locator('.task-avatar').allTextContents();

test('le responsable ouvre la ligne, un contributeur suit, le reste est compte', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Responsable assigne')).toEqual(['BK', 'AM', '+1']);
});

test('un responsable qui n est pas assigne compte quand meme les assignes', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Responsable hors equipe projet')).toEqual(['DS', 'AM', '+2']);
});

test('sans responsable, les deux premiers assignes prennent la place', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Sans responsable')).toEqual(['AM', 'BK', '+1']);
});

test('un seul intervenant n affiche aucun compteur', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Un seul intervenant')).toEqual(['CR']);
});

test('une ligne sans personne n affiche aucune pastille', async ({ page }) => {
    await ouvrirGantt(page);

    expect(await pastilles(page, 'Personne')).toEqual([]);
});
