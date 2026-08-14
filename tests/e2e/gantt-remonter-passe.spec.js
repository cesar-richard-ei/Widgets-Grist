'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Règle posée en revue : « pour chaque vue, quel que soit le niveau d'expand, on puisse remonter
// jusqu'au début de la première tâche affichable ». Une vue glissante figeait sa borne gauche sur
// la fenêtre courante, rendant le passé inatteignable au défilement.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

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
        records: [
            { id: 1, titre: 'Chantier historique', projet: 1, dateDebut: j(-400), dateEcheance: j(-330), statut: 'todo', type: 'tache', priorite: '2' },
            { id: 2, titre: 'En cours', projet: 1, dateDebut: j(-5), dateEcheance: j(20), statut: 'todo', type: 'tache', priorite: '2' }
        ]
    }
};

async function ouvrirGantt(page, vue) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    if (vue) {
        await page.locator('.view-controls .btn[data-view="' + vue + '"]').click();
        await page.waitForSelector('.view-controls .btn[data-view="' + vue + '"].active');
    }
}

// Jours entre le début de la plage dessinée et la tâche la plus ancienne : négatif si la plage
// commence après elle, donc si le passé reste inatteignable.
const margeAvantLaPlusAncienne = (page) => page.evaluate(() => {
    const plusAncienne = Math.min(...tasks.filter(t => t.dateDebut).map(t => t.dateDebut));
    return Math.round((plusAncienne * 1000 - effectiveStart.getTime()) / 86400000);
});

for (const vue of ['week', 'month', 'quarter', 'semester', 'year']) {
    test('la vue ' + vue + ' remonte jusqu a la tache la plus ancienne', async ({ page }) => {
        await ouvrirGantt(page, vue);

        expect(await margeAvantLaPlusAncienne(page)).toBeGreaterThanOrEqual(0);
    });
}

test('la barre de la tache ancienne est dessinee dans la plage', async ({ page }) => {
    await ouvrirGantt(page, 'semester');

    const barre = page.locator('#timelineGrid .gantt-bar[data-id="1"]');
    await expect(barre).toHaveCount(1);
    const gauche = await barre.evaluate((el) => parseFloat(el.style.left));
    expect(gauche).toBeGreaterThanOrEqual(0);
});

test('la vue s ouvre malgre tout sur aujourd hui', async ({ page }) => {
    await ouvrirGantt(page, 'semester');

    const ecart = await page.evaluate(() => {
        const sc = document.getElementById('timelineScroll');
        const marque = document.querySelector('#timelineGrid .today-line, #timelineGrid .gantt-today-line');
        if (!marque) return null;
        return Math.abs(parseFloat(marque.style.left) - sc.scrollLeft);
    });
    if (ecart !== null) expect(ecart).toBeLessThan(300);
});
