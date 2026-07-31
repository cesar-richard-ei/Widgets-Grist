'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le repli sur les donnees d'exemple ne doit repondre qu'a une absence de Grist, jamais a
// une lenteur : sur un poste modeste, les lectures depassent le delai du filet et le widget
// remplacait les donnees reelles par celles de la demo, en desactivant les ecritures.

// Grist repond au handshake, mais chaque lecture de table traine.
function simulacreLent(page, ms, doc) {
    return page.addInitScript((cfg) => {
        window.grist = window.createFakeGrist(cfg.doc || {});
        const vrai = window.grist.docApi.fetchTable;
        window.grist.docApi.fetchTable = async function (nom) {
            await new Promise((r) => setTimeout(r, cfg.ms));
            return vrai.call(this, nom);
        };
    }, { ms: ms, doc: doc });
}

// Grist absent : le handshake ne repond jamais (widget ouvert hors iframe Grist).
function simulacreMuet(page) {
    return page.addInitScript(() => {
        window.grist = window.createFakeGrist({});
        window.grist.ready = () => new Promise(() => {});
    });
}

async function preparer(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
}

const VUES = ['gantt', 'kanban', 'calendar', 'dashboard'];

for (const vue of VUES) {
    test(vue + ' : des lectures lentes ne declenchent pas la demo', async ({ page }) => {
        await preparer(page);
        await simulacreLent(page, 3000);
        await page.goto('http://localhost:3001/tasks_app/' + vue + '.html');

        // Passe le delai du filet (2.8s) alors que les lectures sont encore en vol.
        await page.waitForTimeout(3200);
        await expect(page.locator('.demo-badge')).toHaveCount(0);
    });
}

test('gantt : sans reponse de Grist, la demo prend le relais', async ({ page }) => {
    await preparer(page);
    await simulacreMuet(page);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');

    await expect(page.locator('.demo-badge')).toHaveCount(1, { timeout: 8000 });
});

// Le Plan se juge sur son etat interne : c'est le drapeau demo qui coupe les ecritures.
const etatPlan = (page) => page.frame({ url: /plan\.html/ }).evaluate(() => ({
    demo: S.demo === true,
    noms: S.team.map((m) => m.nom)
}));

async function ouvrirPlanEnCadre(page) {
    // plan.html bascule en demo s'il est ouvert hors iframe : il faut un cadre.
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.setContent('<iframe id="f" style="width:100%;height:600px;border:0" src="http://localhost:3001/tasks_app/plan.html?shell=1"></iframe>');
}

const DOC = {
    Tasks: {
        columns: { titre: { type: 'Text' }, statut: { type: 'Choice' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, assignees: { type: 'RefList:Team' }, charges: { type: 'Text' }, dateCloture: { type: 'Date' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, projet: { type: 'Ref:Projects' } },
        records: [{ id: 1, titre: 'Cadrage', statut: 'inprogress', dateDebut: 1784152800, dateEcheance: 1784757600, assignees: ['L', 1], charges: '[{"teamId":1,"heures":20}]', estimationH: 20, tempsPasse: 5, projet: 1 }]
    },
    Team: {
        columns: { nom: { type: 'Text' }, role: { type: 'Choice' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, capaciteHebdo: { type: 'Numeric' }, indispos: { type: 'Text' } },
        records: [{ id: 1, nom: 'Membre Reel', role: 'Dev', couleur: '#3e5de7', actif: true, capaciteHebdo: 35 }]
    },
    Projects: { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Projet Reel', couleur: '#3e5de7' }] }
};

test('plan : des lectures lentes ne declenchent pas la demo', async ({ page }) => {
    await preparer(page);
    await simulacreLent(page, 3000, DOC);
    await ouvrirPlanEnCadre(page);

    await page.waitForTimeout(3200);
    expect((await etatPlan(page)).demo).toBe(false);

    await expect.poll(async () => (await etatPlan(page)).noms, { timeout: 15000 }).toEqual(['Membre Reel']);
});

test('plan : sans reponse de Grist, la demo prend le relais', async ({ page }) => {
    await preparer(page);
    await simulacreMuet(page);
    await ouvrirPlanEnCadre(page);

    await expect.poll(async () => (await etatPlan(page)).demo, { timeout: 8000 }).toBe(true);
});
