'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Une table refusée par Grist, faute de droits, produisait exactement le même écran qu'une erreur
// de structure : un Gantt incomplet et aucun message. Le widget nomme désormais ce qu'il n'a pas pu
// lire, sans s'arrêter pour autant.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
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
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }
        },
        records: [{ id: 1, titre: 'Atelier de cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2' }]
    }
};

// Refuse la lecture d'une table, comme le ferait Grist sur un document dont l'utilisateur n'a pas
// tous les accès.
async function ouvrirGantt(page, refusee) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript(([d, table]) => {
        window.grist = window.createFakeGrist(d);
        if (table) {
            const vraie = window.grist.docApi.fetchTable.bind(window.grist.docApi);
            window.grist.docApi.fetchTable = (nom) => nom === table
                ? Promise.reject(new Error('Access denied'))
                : vraie(nom);
        }
        try { localStorage.clear(); } catch (e) {}
    }, [DOC, refusee || null]);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

test('une table refusee est nommee a l ecran', async ({ page }) => {
    await ouvrirGantt(page, 'Team');

    const alerte = page.locator('#alerteTables');
    await expect(alerte).toBeVisible();
    await expect(alerte).toContainText('Team');
});

test('le reste du Gantt continue de s afficher', async ({ page }) => {
    await ouvrirGantt(page, 'Team');

    await expect(page.locator('#taskList .task-row', { hasText: 'Socle technique' })).toHaveCount(1);
});

test('sans refus, aucune alerte', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#alerteTables')).toBeHidden();
});

test('une table absente du document ne declenche pas d alerte', async ({ page }) => {
    await ouvrirGantt(page, 'Categorie_de_projet');

    await expect(page.locator('#alerteTables')).toBeHidden();
});
