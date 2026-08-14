'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Document « UI du volet tâche », premier lot : ce qui se masque et ce qui se renomme. L'élément
// « parent » du cadrage désigne le rappel du projet en haut du volet, pas la tâche parente.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'IA et codage', couleur: '#3e5de7', actif: true }] },
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
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
        },
        records: [{ id: 1, titre: 'Cadrage outils de codage', chantier: 1, projet: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 1] }]
    }
};

async function ouvrirFiche(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await page.locator('#taskList .task-row', { hasText: 'Cadrage outils' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

test('la barre de couleur de priorite quitte le volet', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(page.locator('#panel .panel-accent-bar')).toHaveCount(0);
});

test('le rappel du projet quitte le haut du volet', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(page.locator('#panel .panel-crumb')).toHaveCount(0);
});

test('les sections Couleur, Checklist et Planning sont retirees', async ({ page }) => {
    await ouvrirFiche(page);

    for (const titre of ['Couleur', 'Checklist', 'Planning']) {
        await expect(page.locator('#panel .panel-section-title', { hasText: titre })).toHaveCount(0);
        await expect(page.locator('#panel .prop-label', { hasText: titre })).toHaveCount(0);
    }
});

test('les assignes deviennent des contributeurs', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(page.locator('#panel .prop-label', { hasText: 'Contributeurs' })).toHaveCount(1);
    await expect(page.locator('#panel')).not.toContainText('Assignés');
});

test('le bouton de suppression est nomme en entier', async ({ page }) => {
    await ouvrirFiche(page);

    const bouton = page.locator('#panel .panel-footer-left .panel-btn.danger');
    await expect(bouton).toHaveText('Supprimer la tâche');
    const largeur = await bouton.evaluate((el) => el.getBoundingClientRect().width);
    expect(largeur).toBeGreaterThan(120);
});

test('la description s ouvre sur deux lignes', async ({ page }) => {
    await ouvrirFiche(page);

    const hauteur = await page.locator('#taskDescription').evaluate((el) => el.getBoundingClientRect().height);
    expect(hauteur).toBeGreaterThanOrEqual(50);
});

test('un chantier garde une fiche coherente', async ({ page }) => {
    await ouvrirFiche(page);
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).click();

    await expect(page.locator('#panel .type-pill.selected')).toHaveText('Chantier');
    await expect(page.locator('#panel .panel-accent-bar')).toHaveCount(0);
    await expect(page.locator('#panel .panel-section-title', { hasText: 'Tâches' })).toHaveCount(1);
});
