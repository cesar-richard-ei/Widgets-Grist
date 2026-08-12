'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Les chantiers quittent la table Tasks pour leur propre table. Le Gantt doit rester lisible
// sur les deux modeles : le lien vers le chantier est porte par Tasks.chantier quand elle
// existe, sinon par Tasks.parentTask si son type designe Chantiers. Seul un parentTask qui
// designe Tasks est une sous-tache.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const COLONNES_TASKS = {
    titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
    priorite: { type: 'Choice' }, statut: { type: 'Choice' }, progression: { type: 'Numeric' },
    assignees: { type: 'RefList:Team' }, type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' },
    tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
    couleur: { type: 'Text' }, subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' },
    charges: { type: 'Text' }, dateCloture: { type: 'Date' }
};

const COLONNES_CHANTIERS = {
    Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' },
    Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' },
    Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' },
    Responsable: { type: 'Ref:Team' }, Statut_chantier: { type: 'Choice' }
};

const TEAM = { columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: [{ id: 1, nom: 'Alice', actif: true, couleur: '#3e5de7' }] };
const PROJECTS = { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } }, records: [{ id: 1, nom: 'Portail', couleur: '#10b981', actif: true }] };
const CHANTIERS = {
    columns: COLONNES_CHANTIERS,
    records: [
        { id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-5), Date_fin: j(20), Projets: ['L', 1], Contributeurs: ['L', 1] },
        // Sans dates : le volet doit les preremplir depuis les taches du chantier.
        { id: 2, Nom_du_chantier: 'Documentation', Projets: ['L', 1] }
    ]
};

// Modele cible : le rattachement est dans chantier, parentTask reste la sous-tache.
const DOC_CIBLE = {
    Chantiers: CHANTIERS,
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ chantier: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' } }, COLONNES_TASKS),
        records: [
            { id: 1, titre: 'Cadrage', chantier: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'inprogress', type: 'tache', priorite: '1', assignees: ['L', 1], estimationH: 8 },
            { id: 2, titre: 'Atelier de recette', chantier: 1, parentTask: 1, dateDebut: j(0), dateEcheance: j(4), statut: 'todo', type: 'tache', priorite: '2' },
            { id: 3, titre: 'Rediger le guide', chantier: 2, dateDebut: j(2), dateEcheance: j(9), statut: 'todo', type: 'tache', priorite: '3', assignees: ['L', 1] }
        ]
    }
};

// Copie de travail : parentTask a ete repointe vers Chantiers, sans colonne chantier. Les ids
// se recouvrent d'une table a l'autre, ce qui ferait rattacher des taches entre elles.
const DOC_COPIE_DE_TRAVAIL = {
    Chantiers: CHANTIERS,
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ parentTask: { type: 'Ref:Chantiers' } }, COLONNES_TASKS),
        records: [
            { id: 1, titre: 'Cadrage', parentTask: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'inprogress', type: 'tache', priorite: '1' },
            { id: 2, titre: 'Atelier de recette', parentTask: 1, dateDebut: j(0), dateEcheance: j(4), statut: 'todo', type: 'tache', priorite: '2' }
        ]
    }
};

// Ancien modele : pas de table Chantiers, parentTask designe une tache.
const DOC_ANCIEN = {
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ parentTask: { type: 'Ref:Tasks' } }, COLONNES_TASKS),
        records: [
            { id: 1, titre: 'Socle technique', dateDebut: j(-5), dateEcheance: j(20), statut: 'inprogress', type: 'tache', priorite: '1', projet: 1 },
            { id: 2, titre: 'Cadrage', parentTask: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2', projet: 1 }
        ]
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

const lignes = (page) => page.locator('#taskList .task-row');
const ligne = (page, titre) => page.locator('#taskList .task-row', { hasText: titre });

test('le chantier est la ligne de niveau 0, la tache est dessous', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await expect(ligne(page, 'Socle technique')).toHaveAttribute('data-depth', '0');

    await ligne(page, 'Socle technique').locator('.tree-chevron').click();

    await expect(ligne(page, 'Cadrage')).toHaveAttribute('data-depth', '1');
});

test('une sous-tache reste sous sa tache, pas sous le chantier', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await ligne(page, 'Socle technique').locator('.tree-chevron').click();
    await ligne(page, 'Cadrage').locator('.tree-chevron').click();

    await expect(ligne(page, 'Atelier de recette')).toHaveAttribute('data-depth', '2');
});

test('le projet du chantier est repris quand la tache n en porte pas', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await expect(ligne(page, 'Socle technique')).toHaveAttribute('data-projet', '1');
});

test('sur la copie de travail, les taches ne sont pas rattachees entre elles', async ({ page }) => {
    await ouvrirGantt(page, DOC_COPIE_DE_TRAVAIL);

    // parentTask=1 designe le chantier 1, pas la tache 1 : « Cadrage » ne doit pas devenir le
    // parent de « Atelier de recette ».
    await expect(ligne(page, 'Socle technique')).toHaveAttribute('data-depth', '0');
    await ligne(page, 'Socle technique').locator('.tree-chevron').click();

    await expect(ligne(page, 'Cadrage')).toHaveAttribute('data-depth', '1');
    await expect(ligne(page, 'Atelier de recette')).toHaveAttribute('data-depth', '1');
});

test('cliquer une ligne chantier ouvre le volet chantier', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await ligne(page, 'Socle technique').click();

    await expect(page.locator('#panel')).toHaveClass(/open/);
    await expect(page.locator('#taskTitle')).toHaveValue('Socle technique');
    // Le type est affiche sans possibilite de changement.
    await expect(page.locator('#panel .panel-type-row')).toContainText('Chantier');
    await expect(page.locator('#panel .type-pill[onclick]')).toHaveCount(0);
});

test('le volet chantier masque les champs prevus', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await ligne(page, 'Socle technique').click();
    const volet = page.locator('#panel');

    for (const absent of ['Priorité', 'Progression', 'Parent', 'Couleur', 'Planning', 'Checklist']) {
        await expect(volet).not.toContainText(absent);
    }
    await expect(volet).toContainText('Ajouter une tâche');
});

test('le volet chantier prend les dates de ses taches quand il n en a pas', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await ligne(page, 'Documentation').click();

    const dates = page.locator('#panel .dates-inline input[type="date"]');
    await expect(dates.first()).not.toHaveValue('');
    await expect(dates.nth(1)).not.toHaveValue('');
});

test('modifier un chantier ecrit dans Chantiers, pas dans Tasks', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await ligne(page, 'Socle technique').click();
    await page.locator('#taskDescription').fill('Cadre technique du portail');
    await page.locator('#taskDescription').blur();

    await expect.poll(() => page.evaluate(async () => {
        const c = await window.grist.docApi.fetchTable('Chantiers');
        return c.Description[c.id.indexOf(1)];
    })).toBe('Cadre technique du portail');

    const titres = await page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.titre;
    });
    expect(titres).toEqual(['Cadrage', 'Atelier de recette', 'Rediger le guide']);
});

// Le parent affiche est recalcule a la lecture : le reecrire remettrait en base l'identifiant
// decale d'un chantier, qui ne designe aucun enregistrement.
test('modifier une tache ne reecrit pas son parent', async ({ page }) => {
    await ouvrirGantt(page, DOC_CIBLE);

    await ligne(page, 'Socle technique').locator('.tree-chevron').click();
    await ligne(page, 'Cadrage').click();
    await expect(page.locator('#panel')).toHaveClass(/open/);

    await page.locator('#taskTitle').fill('Cadrage revu');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.titre[t.id.indexOf(1)];
    })).toBe('Cadrage revu');

    const enBase = await page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        const i = t.id.indexOf(1);
        return { chantier: t.chantier[i], parentTask: t.parentTask[i] || 0 };
    });
    expect(enBase).toEqual({ chantier: 1, parentTask: 0 });
});

test('sans table Chantiers, la hierarchie des taches est inchangee', async ({ page }) => {
    await ouvrirGantt(page, DOC_ANCIEN);

    await expect(lignes(page).first()).toContainText('Socle technique');
    await lignes(page).first().locator('.tree-chevron').click();

    await expect(ligne(page, 'Cadrage')).toHaveAttribute('data-depth', '1');
    await expect(page.locator('#panel')).not.toHaveClass(/open/);
    await lignes(page).first().click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
});
