'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Repère de déploiement : savoir d'un coup d'œil quelle version est servie. Réservé à qui l'active,
// la barre d'outils n'ayant pas à porter ça pour tout le monde.

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }] },
    Tasks: {
        columns: {
            parentTask: { type: 'Ref:Tasks' }, titre: { type: 'Text' }, description: { type: 'Text' },
            dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, priorite: { type: 'Choice' },
            statut: { type: 'Choice' }, progression: { type: 'Numeric' }, assignees: { type: 'RefList:Team' },
            type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' }, tags: { type: 'ChoiceList' },
            estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, couleur: { type: 'Text' },
            subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' }, charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [{ id: 1, titre: 'Cadrage', projet: 1, dateDebut: 1786000000, dateEcheance: 1787000000, statut: 'todo', type: 'tache', priorite: '2' }]
    }
};

async function ouvrirGantt(page, reglage) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript(([d, valeur]) => {
        window.grist = window.createFakeGrist(d);
        try {
            localStorage.clear();
            if (valeur !== null) localStorage.setItem('taskflow_show_version', valeur);
        } catch (e) {}
    }, [DOC, reglage === undefined ? null : reglage]);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

test('sans le reglage, aucune version affichee', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#badgeVersion')).toBeHidden();
});

test('le reglage a true affiche la version en tete de barre', async ({ page }) => {
    await ouvrirGantt(page, 'true');

    const badge = page.locator('#badgeVersion');
    await expect(badge).toBeVisible();
    await expect(badge).not.toBeEmpty();

    // Tout en haut à gauche : avant le premier contrôle de la barre.
    const place = await page.evaluate(() => {
        const b = document.getElementById('badgeVersion').getBoundingClientRect();
        const premier = document.getElementById('sortSelect').getBoundingClientRect();
        return b.left < premier.left && b.top < 80;
    });
    expect(place).toBe(true);
});

test('une autre valeur ne declenche rien', async ({ page }) => {
    await ouvrirGantt(page, 'oui');

    await expect(page.locator('#badgeVersion')).toBeHidden();
});

test('hors deploiement, la version annonce la copie locale', async ({ page }) => {
    await ouvrirGantt(page, 'true');

    await expect(page.locator('#badgeVersion')).toHaveText('local');
});
