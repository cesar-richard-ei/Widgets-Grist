'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le responsable d'un chantier ou d'une tache porte la couleur de la ligne, prise sur son
// enregistrement dans la table des effectifs.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const ROUGE = '#bd0a0a';
const VERT = '#10b981';
// Le navigateur normalise les couleurs de style en rgb().
const enRgb = (hex) => 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';

const COLONNES_TASKS = {
    titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
    priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
    assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
    tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
    couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
    charges: { type: 'Text' }, dateCloture: { type: 'Date' }, parentTask: { type: 'Ref:Tasks' }
};

const TEAM = {
    columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } },
    records: [
        { id: 1, nom: 'Alice', actif: true, couleur: ROUGE },
        { id: 2, nom: 'Bob', actif: true, couleur: VERT }
    ]
};
const PROJECTS = { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true }] };

const CHANTIERS = {
    columns: {
        Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' },
        Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' },
        Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' },
        Responsable: { type: 'Ref:Team' }
    },
    records: [{ id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1], Responsable: 2 }]
};

const DOC_AVEC_RESPONSABLE = {
    Chantiers: CHANTIERS,
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ chantier: { type: 'Ref:Chantiers' }, Responsable: { type: 'Ref:Team' } }, COLONNES_TASKS),
        records: [{ id: 1, titre: 'Cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1', Responsable: 1, assignees: ['L', 2] }]
    }
};

// Sans la colonne : le mode n'a rien a colorer et ne doit pas etre propose.
const DOC_SANS_RESPONSABLE = {
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: COLONNES_TASKS,
        records: [{ id: 1, titre: 'Cadrage', dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '1', projet: 1 }]
    }
};

async function ouvrirGantt(page, doc) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => {
        window.grist = window.createFakeGrist(d);
        try { localStorage.removeItem('taskflow_gantt_expanded'); } catch (e) {}
    }, doc);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

// Couleur de fond de la barre d'une ligne, telle que posee par le rendu.
const fondDeLaBarre = (page, titre) => page.evaluate((t) => {
    const ligne = [...document.querySelectorAll('#taskList .task-row')].find(l => l.innerText.includes(t));
    if (!ligne) return null;
    const barre = document.querySelector('#timelineGrid .gantt-bar[data-id="' + ligne.dataset.id + '"]');
    return barre ? barre.style.background : null;
}, titre);

test('le mode Responsable est le defaut quand la colonne existe', async ({ page }) => {
    await ouvrirGantt(page, DOC_AVEC_RESPONSABLE);

    await expect(page.locator('#colorSelect option[value="responsable"]')).toHaveCount(1);
    await expect(page.locator('#colorSelect')).toHaveValue('responsable');
});

test('le chantier prend la couleur de son responsable', async ({ page }) => {
    await ouvrirGantt(page, DOC_AVEC_RESPONSABLE);
    await page.locator('#colorSelect').selectOption('responsable');

    expect(await fondDeLaBarre(page, 'Socle technique')).toContain(enRgb(VERT));
});

test('la tache prend la couleur de son responsable, pas de son assigne', async ({ page }) => {
    await ouvrirGantt(page, DOC_AVEC_RESPONSABLE);
    await page.locator('#colorSelect').selectOption('responsable');

    await page.locator('#taskList .task-row', { hasText: 'Socle technique' }).locator('.tree-chevron').click();
    await expect(page.locator('#taskList .task-row', { hasText: 'Cadrage' })).toBeVisible();
    await page.waitForSelector('#timelineGrid .gantt-bar[data-id="1"]');

    const fond = await fondDeLaBarre(page, 'Cadrage');
    expect(fond).toContain(enRgb(ROUGE));
    expect(fond).not.toContain(enRgb(VERT));
});

// Grist ne notifie que la table du widget : modifier les effectifs, les projets ou les chantiers
// passe inapercu. Le widget relit quand il reprend la main, ce qui couvre le geste reel, aller
// changer une couleur dans la table puis revenir sur le Gantt.
test('changer la couleur d un membre est repris au retour sur le widget', async ({ page }) => {
    await ouvrirGantt(page, DOC_AVEC_RESPONSABLE);
    await page.locator('#colorSelect').selectOption('responsable');
    expect(await fondDeLaBarre(page, 'Socle technique')).toContain(enRgb(VERT));

    await page.evaluate(() => window.grist.docApi.applyUserActions([['UpdateRecord', 'Team', 2, { couleur: '#ff0000' }]]));

    // Rien ne bouge tant que le widget n'a pas reperdu puis reprit la main.
    expect(await fondDeLaBarre(page, 'Socle technique')).toContain(enRgb(VERT));

    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });

    await expect.poll(() => fondDeLaBarre(page, 'Socle technique')).toContain('rgb(255, 0, 0)');
});

test('sans colonne Responsable, le mode n est pas propose', async ({ page }) => {
    await ouvrirGantt(page, DOC_SANS_RESPONSABLE);

    await expect(page.locator('#colorSelect option[value="responsable"]')).toHaveCount(0);
    await expect(page.locator('#colorSelect')).toHaveValue('project');
});
