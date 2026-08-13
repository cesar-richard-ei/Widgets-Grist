'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Demande de la frame « UI de la vue GANTT » : « Le champ devrait aller a la ligne plutot que de
// se prolonger en longueur (difficile a lire quand on veut relire un long titre) ».

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const TITRE_LONG = "Production des user flow core et cibles Cohort360 pour le portail d'habilitations et ses briques connexes";

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
            { id: 1, titre: TITRE_LONG, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1', projet: 1 },
            { id: 2, titre: 'Court', dateDebut: j(0), dateEcheance: j(3), statut: 'todo', type: 'tache', priorite: '2', projet: 1 }
        ]
    }
};

async function ouvrirVolet(page, titre) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    await page.locator('#taskList .task-row', { hasText: titre }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    await page.waitForTimeout(300);
}

const mesures = (page) => page.evaluate(() => {
    const t = document.getElementById('taskTitle');
    return { balise: t.tagName, hauteur: t.getBoundingClientRect().height, debordement: t.scrollWidth - t.clientWidth };
});

test('un titre long est lisible en entier, sans defilement lateral', async ({ page }) => {
    await ouvrirVolet(page, TITRE_LONG);

    const m = await mesures(page);
    expect(m.debordement).toBeLessThanOrEqual(1);
    // Plusieurs lignes : la hauteur depasse nettement celle d'une ligne unique.
    expect(m.hauteur).toBeGreaterThan(60);
});

test('un titre court garde une hauteur sobre', async ({ page }) => {
    await ouvrirVolet(page, 'Court');

    expect((await mesures(page)).hauteur).toBeLessThan(60);
});

test('la saisie du titre reste enregistree', async ({ page }) => {
    await ouvrirVolet(page, 'Court');

    await page.locator('#taskTitle').fill('Court revu');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.titre[t.id.indexOf(2)];
    })).toBe('Court revu');
});

test('la hauteur suit la saisie', async ({ page }) => {
    await ouvrirVolet(page, 'Court');
    const avant = (await mesures(page)).hauteur;

    await page.locator('#taskTitle').fill(TITRE_LONG + ' ' + TITRE_LONG);

    expect((await mesures(page)).hauteur).toBeGreaterThan(avant);
});
