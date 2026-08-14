'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le responsable reprend l'interface des contributeurs, avec une seule personne à la fois. Le
// curseur de progression disparaît au profit de la jauge et de ses paliers.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const COLONNES = {
    chantier: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' },
    titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
    priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
    assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
    tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
    couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
    charges: { type: 'Text' }, dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
};

const DOC = {
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'IA et codage', couleur: '#3e5de7', actif: true }] },
    Team: {
        columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' }, role: { type: 'Choice' } },
        records: [
            { id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7', role: 'Produit' },
            { id: 2, nom: 'Bruno Klein', actif: true, couleur: '#10b981', role: 'Dev' }
        ]
    },
    Chantiers: {
        columns: { Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' }, Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' }, Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' } },
        records: [{ id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1] }]
    },
    Tasks: {
        columns: COLONNES,
        records: [{ id: 1, titre: 'Cadrage des outils', chantier: 1, projet: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 1], Responsable: 1 }]
    }
};

function sansColonneResponsable() {
    const doc = JSON.parse(JSON.stringify(DOC));
    delete doc.Tasks.columns.Responsable;
    delete doc.Tasks.records[0].Responsable;
    return doc;
}

async function ouvrirFiche(page, doc) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, doc || DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await page.locator('#taskList .task-row', { hasText: 'Cadrage des outils' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

const responsableEnBase = (page) => page.evaluate(async () => {
    const t = await window.grist.docApi.fetchTable('Tasks');
    return t.Responsable[t.id.indexOf(1)];
});

test('le responsable a sa ligne, entre la progression et les contributeurs', async ({ page }) => {
    await ouvrirFiche(page);

    const ordre = await page.evaluate(() => Array.from(document.querySelectorAll('#panelContent .prop-label, #panelContent .panel-section-title'))
        .map(el => ({ t: el.textContent.trim(), y: el.getBoundingClientRect().top }))
        .sort((a, b) => a.y - b.y).map(x => x.t));
    expect(ordre.indexOf('Responsable')).toBeGreaterThan(ordre.indexOf('Progression'));
    expect(ordre.indexOf('Responsable')).toBeLessThan(ordre.indexOf('Contributeurs'));
});

test('le responsable en place est affiche', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(page.locator('#responsableSelect').locator('..')).toContainText('Alice Martin');
});

test('choisir un autre responsable remplace le precedent', async ({ page }) => {
    await ouvrirFiche(page);

    await page.locator('#responsableSelect .addbtn').click();
    await page.locator('#responsableSelect .multi-select-option', { hasText: 'Bruno Klein' }).click();

    await expect.poll(() => responsableEnBase(page)).toBe(2);
    await expect(page.locator('#panel .resp-choisi')).toHaveCount(1);
});

test('le responsable se retire', async ({ page }) => {
    await ouvrirFiche(page);

    await page.locator('#panel .resp-choisi .asg-x').click();

    await expect.poll(() => responsableEnBase(page)).toBeFalsy();
});

test('sans la colonne, la ligne responsable n apparait pas', async ({ page }) => {
    await ouvrirFiche(page, sansColonneResponsable());

    await expect(page.locator('#panel .prop-label', { hasText: 'Responsable' })).toHaveCount(0);
});

test('le curseur de progression laisse la place a la jauge et aux paliers', async ({ page }) => {
    await ouvrirFiche(page);

    await expect(page.locator('#panel .progress-slider')).toHaveCount(0);
    await expect(page.locator('#panel .progress-bar-mini')).toHaveCount(1);
    await expect(page.locator('#panel .progress-preset')).toHaveCount(5);
});
