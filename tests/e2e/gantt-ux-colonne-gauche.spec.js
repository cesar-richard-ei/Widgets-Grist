'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Demandes de la frame « UI de la vue GANTT » du board : degager de la place dans la colonne de
// gauche en retirant ce qui ne sert pas, et ne garder l'avancement que sur les chantiers.

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
            { id: 1, titre: 'Cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1', progression: 40, subtasks: '[{"id":1,"text":"a","done":true},{"id":2,"text":"b","done":false}]' }
        ]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => {
        window.grist = window.createFakeGrist(d);
        try { localStorage.clear(); } catch (e) {}
    }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

const ligne = (page, titre) => page.locator('#taskList .task-row', { hasText: titre });

async function deplierLeChantier(page) {
    await ligne(page, 'Socle technique').locator('.tree-chevron').click();
    await expect(ligne(page, 'Cadrage')).toBeVisible();
}

test('la barre de couleur de priorite ne prend plus de place', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#taskList .task-priority-bar')).toHaveCount(0);
});

test('la poignee de glisser n apparait qu en tri manuel', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#taskList .drag-handle')).toHaveCount(0);

    await page.locator('#sortSelect').selectOption('manual');

    await expect(page.locator('#taskList .drag-handle').first()).toBeVisible();
});

test('l avancement reste sur le chantier et quitte la tache', async ({ page }) => {
    await ouvrirGantt(page);

    const chantier = ligne(page, 'Socle technique');
    await expect(chantier.locator('.task-progress-badge')).toHaveCount(1);
    await expect(chantier.locator('.task-subtask-badge')).toHaveCount(1);

    await deplierLeChantier(page);

    const tache = ligne(page, 'Cadrage');
    await expect(tache.locator('.task-progress-badge')).toHaveCount(0);
    await expect(tache.locator('.task-subtask-badge')).toHaveCount(0);
    // Les dates et les assignes restent, seul l'avancement disparait.
    await expect(tache.locator('.task-dates')).toHaveCount(1);
});

test('la legende ne prend plus de place sous le Gantt', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#ganttLegend')).toHaveCount(0);
});
