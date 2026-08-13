'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Demande du document « Propositions d'ameliorations UX » : « Ajouter la possibilite de deplacer
// dans le temps un jalon depuis le graphique, comme c'est le cas pour une tache ».

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice', actif: true, couleur: '#3e5de7' }] },
    Tasks: {
        columns: {
            parentTask: { type: 'Ref:Tasks' },
            titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
            priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
            assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
            tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
            couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [
            { id: 1, titre: 'Livraison MVP', dateDebut: j(0), dateEcheance: j(0), statut: 'todo', type: 'jalon', priorite: '1', projet: 1 }
        ]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.waitForSelector('#timelineGrid .gantt-milestone');
}

const datesDuJalon = (page) => page.evaluate(async () => {
    const t = await window.grist.docApi.fetchTable('Tasks');
    const i = t.id.indexOf(1);
    return { debut: t.dateDebut[i], echeance: t.dateEcheance[i] };
});

async function glisserLeJalon(page, dx) {
    const boite = await page.locator('#timelineGrid .gantt-milestone').first().boundingBox();
    const y = boite.y + boite.height / 2;
    await page.mouse.move(boite.x + boite.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(boite.x + boite.width / 2 + dx, y, { steps: 10 });
    await page.mouse.up();
}

test('un jalon se deplace dans le temps a la souris', async ({ page }) => {
    await ouvrirGantt(page);
    const avant = await datesDuJalon(page);

    await glisserLeJalon(page, 120);

    await expect.poll(async () => (await datesDuJalon(page)).debut).toBeGreaterThan(avant.debut);
});

test('un jalon garde une date unique apres deplacement', async ({ page }) => {
    await ouvrirGantt(page);

    await glisserLeJalon(page, 120);

    await expect.poll(async () => {
        const d = await datesDuJalon(page);
        return d.debut === d.echeance;
    }).toBe(true);
});
