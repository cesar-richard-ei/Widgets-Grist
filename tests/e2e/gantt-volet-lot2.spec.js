'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Document « UI du volet tâche », second lot : les sections à créer. Dépendances et Tags quittent
// le fourre-tout « Détails », et le rattachement au chantier devient éditable depuis la fiche.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'IA et codage', couleur: '#3e5de7', actif: true }] },
    Team: { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }] },
    Chantiers: {
        columns: { Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' }, Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' }, Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' } },
        records: [
            { id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] },
            { id: 2, Nom_du_chantier: 'Recette metier', Date_debut: j(0), Date_fin: j(40), Projets: ['L', 1] }
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
            charges: { type: 'Text' }, dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
        },
        records: [
            { id: 1, titre: 'Cadrage des outils', chantier: 1, projet: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', tags: ['L', 'poc'] },
            { id: 2, titre: 'Etude comparative', chantier: 1, projet: 1, dateDebut: j(-2), dateEcheance: j(8), statut: 'todo', type: 'tache', priorite: '2' }
        ]
    }
};

async function ouvrirFiche(page, titre) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await page.locator('#taskList .task-row', { hasText: titre || 'Cadrage des outils' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

const section = (page, titre) => page.locator('#panel .panel-section', { has: page.locator('.panel-section-title', { hasText: titre }) });

test('les dependances ont leur propre section', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(section(page, 'Dépendances')).toHaveCount(1);
    await expect(section(page, 'Dépendances').locator('#depsSelect')).toHaveCount(1);
});

test('les tags ont leur propre section', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(section(page, 'Tags')).toHaveCount(1);
    await expect(section(page, 'Tags').locator('#tagInput')).toHaveCount(1);
});

test('le fourre-tout Details disparait', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(page.locator('#panel .panel-section-title', { hasText: 'Détails' })).toHaveCount(0);
});

test('le chantier de rattachement a sa section et son selecteur', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(section(page, 'Chantier')).toHaveCount(1);
    await expect(page.locator('#chantierSelect')).toHaveValue('1');
    const choix = await page.locator('#chantierSelect option').allTextContents();
    expect(choix.join(' ')).toContain('Recette metier');
});

test('changer de chantier depuis la fiche est enregistre', async ({ page }) => {
    await ouvrirFiche(page);

    await page.locator('#chantierSelect').selectOption('2');

    await expect.poll(() => page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.chantier[t.id.indexOf(1)];
    })).toBe(2);
});

test('la ligne rejoint son nouveau chantier dans l arbre', async ({ page }) => {
    await ouvrirFiche(page);

    await page.locator('#chantierSelect').selectOption('2');

    await page.locator('#taskList .task-row', { hasText: 'Recette metier' }).locator('.tree-chevron').click();
    await expect(page.locator('#taskList .task-row', { hasText: 'Cadrage des outils' })).toHaveAttribute('data-depth', '1');
});

test('un chantier ne propose pas de rattachement a un chantier', async ({ page }) => {
    await ouvrirFiche(page);
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).click();

    await expect(page.locator('#chantierSelect')).toHaveCount(0);
});
