'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Demandes de la frame « UI de la vue GANTT » : pouvoir regler la largeur de la colonne de gauche
// et la retrouver, et ouvrir le volet sur la moitie de la place disponible plutot que sur une
// largeur fixe, tout en pouvant l'etirer.

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
        records: [{ id: 1, titre: 'Cadrage', dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1', projet: 1 }]
    }
};

async function ouvrirGantt(page, options) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((cfg) => {
        window.grist = window.createFakeGrist(cfg.doc);
        // Les scripts d'init rejouent a chaque navigation : sans ce marqueur, le nettoyage
        // effacerait aussi les reglages que le test vient d'ecrire.
        try {
            if (!cfg.garderReglages && !localStorage.getItem('__test_nettoye')) {
                localStorage.clear();
                localStorage.setItem('__test_nettoye', '1');
            }
        } catch (e) {}
    }, { doc: DOC, garderReglages: options && options.garderReglages });
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

const largeurColonneGauche = (page) => page.evaluate(() => document.getElementById('taskList').getBoundingClientRect().width);
const largeurVolet = (page) => page.evaluate(() => document.getElementById('panel').getBoundingClientRect().width);

async function glisser(page, selecteur, dx) {
    const boite = await page.locator(selecteur).boundingBox();
    const y = boite.y + boite.height / 2;
    await page.mouse.move(boite.x + boite.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(boite.x + boite.width / 2 + dx, y, { steps: 8 });
    await page.mouse.up();
}

test('la colonne de gauche se redimensionne a la souris', async ({ page }) => {
    await ouvrirGantt(page);
    const avant = await largeurColonneGauche(page);

    await glisser(page, '#poigneeTaskList', 120);

    const apres = await largeurColonneGauche(page);
    expect(apres).toBeGreaterThan(avant + 80);
});

test('la largeur choisie est retrouvee a la reouverture', async ({ page }) => {
    await ouvrirGantt(page);
    await glisser(page, '#poigneeTaskList', 120);
    const choisie = await largeurColonneGauche(page);

    await ouvrirGantt(page, { garderReglages: true });

    expect(Math.abs(await largeurColonneGauche(page) - choisie)).toBeLessThan(2);
});

test('la colonne de gauche ne peut pas disparaitre ni manger la timeline', async ({ page }) => {
    await ouvrirGantt(page);

    await glisser(page, '#poigneeTaskList', -600);
    expect(await largeurColonneGauche(page)).toBeGreaterThan(100);

    await glisser(page, '#poigneeTaskList', 3000);
    const largeurVue = await page.evaluate(() => document.getElementById('ganttWrapper').getBoundingClientRect().width);
    expect(await largeurColonneGauche(page)).toBeLessThan(largeurVue * 0.75);
});

test('le volet s ouvre sur la moitie de la place disponible', async ({ page }) => {
    await ouvrirGantt(page);

    // Mesure avant ouverture : le wrapper se retrecit ensuite d'une marge egale au volet.
    const attendu = await page.evaluate(() => {
        const vue = document.getElementById('ganttWrapper').getBoundingClientRect().width;
        const gauche = document.getElementById('taskList').getBoundingClientRect().width;
        return (vue - gauche) / 2;
    });

    await page.locator('#taskList .task-row', { hasText: 'Cadrage' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    await page.waitForTimeout(400);
    expect(Math.abs(await largeurVolet(page) - attendu)).toBeLessThan(attendu * 0.15);
});

test('le volet s etire a la souris', async ({ page }) => {
    await ouvrirGantt(page);
    await page.locator('#taskList .task-row', { hasText: 'Cadrage' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    await page.waitForTimeout(400);
    const avant = await largeurVolet(page);

    await glisser(page, '#poigneePanel', -250);

    expect(await largeurVolet(page)).toBeGreaterThan(avant + 100);
});
