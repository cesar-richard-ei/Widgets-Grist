'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le document du métier nomme la colonne de rattachement « Chantiers » et non « chantier ».
// Le lien se reconnaît à son type, jamais à son nom : un nom en dur laissait les 79 tâches sans
// chantier, donc sans projet hérité, donc toutes sous « Sans projet ».

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, responsable: { type: 'Ref:Team' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }] },
    Chantiers: {
        columns: { Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' }, Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' }, Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' } },
        records: [{ id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] }]
    },
    Tasks: {
        columns: {
            Chantiers: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' },
            titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
            priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
            assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
            tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
            couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
        },
        records: [{ id: 1, titre: 'Atelier de cadrage', Chantiers: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2' }]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

const ligne = (page, titre) => page.locator('#taskList .task-row', { hasText: titre });

test('le chantier remonte en ligne racine malgre le nom de colonne', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(ligne(page, 'Socle technique')).toHaveAttribute('data-depth', '0');
});

test('la tache est rattachee a son chantier', async ({ page }) => {
    await ouvrirGantt(page);

    await ligne(page, 'Socle technique').locator('.tree-chevron').click();
    await expect(ligne(page, 'Atelier de cadrage')).toHaveAttribute('data-depth', '1');
});

test('le projet du chantier est herite, pas de Sans projet', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#taskList .groupe-projet')).toHaveText(/Portail/);
    await expect(page.locator('#taskList .groupe-projet', { hasText: 'Sans projet' })).toHaveCount(0);
});

test('une tache creee depuis un chantier est ecrite dans la bonne colonne', async ({ page }) => {
    await ouvrirGantt(page);

    await ligne(page, 'Socle technique').click();
    await page.locator('#panel button', { hasText: 'Ajouter une tâche' }).click();
    await page.locator('#taskTitle').fill('Recette metier');
    await page.locator('#panel .panel-btn.success').click();

    await expect.poll(() => page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        const i = t.titre.indexOf('Recette metier');
        return i === -1 ? null : t.Chantiers[i];
    })).toBe(1);
});
