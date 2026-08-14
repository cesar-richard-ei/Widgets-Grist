'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Les chantiers ont leur propre table et portent le rattachement au projet : sur le document du
// metier, aucune tache ne renseigne Tasks.projet. Le plan de charge doit donc resoudre le projet
// d'une tache par son chantier, sans jamais reecrire ce rattachement.

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const COLONNES_TASKS = {
    titre: { type: 'Text' },
    // Le dernier statut declare vaut cloture : sans choix explicites, le Plan les deduit des
    // valeurs presentes et prendrait « todo » pour un statut terminal.
    statut: { type: 'Choice', widgetOptions: JSON.stringify({ choices: ['todo', 'inprogress', 'done'] }) },
    type: { type: 'Choice' }, priorite: { type: 'Choice' },
    progression: { type: 'Numeric' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
    assignees: { type: 'RefList:Team' }, charges: { type: 'Text' }, dateCloture: { type: 'Date' },
    estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, projet: { type: 'Ref:Projects' }
};

const COLONNES_CHANTIERS = {
    Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' },
    Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' },
    Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }
};

const TEAM = {
    columns: { nom: { type: 'Text' }, role: { type: 'Choice' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, capaciteHebdo: { type: 'Numeric' }, indispos: { type: 'Text' } },
    records: [
        { id: 1, nom: 'Alice Martin', role: 'Dev', couleur: '#3e5de7', actif: true, capaciteHebdo: 35 },
        { id: 2, nom: 'Bob Durant', role: 'Dev', couleur: '#10b981', actif: true, capaciteHebdo: 35 }
    ]
};

const PROJECTS = {
    columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' } },
    records: [
        { id: 1, nom: 'Portail habilitations', couleur: '#3e5de7', actif: true },
        { id: 2, nom: 'Guides utilisateurs', couleur: '#10b981', actif: true }
    ]
};

const CHANTIERS = {
    columns: COLONNES_CHANTIERS,
    records: [
        { id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(0), Date_fin: j(20), Projets: ['L', 1] },
        { id: 2, Nom_du_chantier: 'Documentation', Projets: ['L', 2] }
    ]
};

// Trois taches chargees, aucune ne renseigne son projet : il n'existe que sur le chantier.
const TACHES_SANS_PROJET = [
    { id: 1, titre: 'Cadrage', statut: 'inprogress', type: 'tache', priorite: '2', dateDebut: j(0), dateEcheance: j(10), assignees: ['L', 1], charges: '[{"teamId":1,"heures":20}]' },
    { id: 2, titre: 'Atelier de recette', statut: 'todo', type: 'tache', priorite: '2', dateDebut: j(0), dateEcheance: j(10), assignees: ['L', 2], charges: '[{"teamId":2,"heures":10}]' },
    { id: 3, titre: 'Rediger le guide', statut: 'todo', type: 'tache', priorite: '3', dateDebut: j(0), dateEcheance: j(10), assignees: ['L', 1], charges: '[{"teamId":1,"heures":8}]' }
];

const avec = (extra) => TACHES_SANS_PROJET.map((t, i) => Object.assign({}, t, extra[i]));

// Modele cible : le rattachement est dans Tasks.chantier, parentTask reste la sous-tache.
const DOC_CIBLE = {
    Chantiers: CHANTIERS,
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ chantier: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' } }, COLONNES_TASKS),
        records: avec([{ chantier: 1 }, { chantier: 1, parentTask: 1 }, { chantier: 2 }])
    }
};

// Document du metier apres migration : la colonne de rattachement s'appelle « Chantiers ».
const DOC_COLONNE_NOMMEE = {
    Chantiers: CHANTIERS,
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ Chantiers: { type: 'Ref:Chantiers' }, parentTask: { type: 'Ref:Tasks' } }, COLONNES_TASKS),
        records: avec([{ Chantiers: 1 }, { Chantiers: 1 }, { Chantiers: 2 }])
    }
};

// Copie de travail du metier : parentTask a ete repointe vers Chantiers, sans colonne chantier.
const DOC_COPIE_DE_TRAVAIL = {
    Chantiers: CHANTIERS,
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ parentTask: { type: 'Ref:Chantiers' } }, COLONNES_TASKS),
        records: avec([{ parentTask: 1 }, { parentTask: 1 }, { parentTask: 2 }])
    }
};

// Ancien modele : pas de table Chantiers, le projet est porte par la tache.
const DOC_ANCIEN = {
    Projects: PROJECTS,
    Team: TEAM,
    Tasks: {
        columns: Object.assign({ parentTask: { type: 'Ref:Tasks' } }, COLONNES_TASKS),
        records: avec([{ projet: 1 }, { projet: 1, parentTask: 1 }, { projet: 2 }])
    }
};

// Le Plan bascule sur les donnees d'exemple hors iframe : il est charge dans un cadre, comme
// dans Grist. Le simulacre est injecte dans tous les cadres de la page.
async function ouvrirPlan(page, doc) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); }, doc);
    await page.goto('http://localhost:3001/tasks_app/plan.html');
    await page.setContent('<iframe id="f" style="width:100%;height:700px;border:0" src="http://localhost:3001/tasks_app/plan.html?shell=1"></iframe>');
    await expect(grille(page).locator('table.grid')).toBeVisible();
}

const plan = (page) => page.frameLocator('#f');
const grille = (page) => plan(page).locator('#gridwrap');
const cadre = (page) => page.frame({ url: /plan\.html\?shell=1/ });
const grouperPar = (page, valeur) => plan(page).locator('#selGroup').selectOption(valeur);
const tacheEnBase = (page, id) => cadre(page).evaluate(async (taskId) => {
    const t = await window.grist.docApi.fetchTable('Tasks');
    const i = t.id.indexOf(taskId);
    return { projet: t.projet[i] || 0, chantier: (t.chantier ? t.chantier[i] : t.parentTask[i]) || 0, charges: t.charges[i] };
}, id);

test('le projet du chantier porte le groupement quand la tache n en porte pas', async ({ page }) => {
    await ouvrirPlan(page, DOC_CIBLE);

    await grouperPar(page, 'project');

    await expect(grille(page)).toContainText('Portail habilitations');
    await expect(grille(page)).toContainText('Guides utilisateurs');
    await expect(grille(page)).not.toContainText('Sans projet');
});

test('le projet est resolu quelle que soit le nom de la colonne de rattachement', async ({ page }) => {
    await ouvrirPlan(page, DOC_COLONNE_NOMMEE);

    await grouperPar(page, 'project');

    await expect(grille(page)).toContainText('Portail habilitations');
    await expect(grille(page)).not.toContainText('Sans projet');
});

test('sur la copie de travail, le projet est resolu par parentTask', async ({ page }) => {
    await ouvrirPlan(page, DOC_COPIE_DE_TRAVAIL);

    await grouperPar(page, 'project');

    await expect(grille(page)).toContainText('Portail habilitations');
    await expect(grille(page)).not.toContainText('Sans projet');
});

test('sans table Chantiers, le groupement par projet reste celui des taches', async ({ page }) => {
    await ouvrirPlan(page, DOC_ANCIEN);

    await grouperPar(page, 'project');

    await expect(grille(page)).toContainText('Portail habilitations');
    await expect(grille(page)).toContainText('Guides utilisateurs');
});

test('le groupement par chantier repartit la charge par chantier', async ({ page }) => {
    await ouvrirPlan(page, DOC_CIBLE);

    await grouperPar(page, 'chantier');

    await expect(grille(page).locator('tr.grp')).toHaveCount(2);
    await expect(grille(page)).toContainText('Socle technique');
    await expect(grille(page)).toContainText('Documentation');
    // Alice porte de la charge sur les deux chantiers, Bob sur le seul socle technique.
    await expect(grille(page).locator('tr.subr')).toHaveCount(3);
});

test('sans table Chantiers, le groupement par chantier n est pas propose', async ({ page }) => {
    await ouvrirPlan(page, DOC_ANCIEN);

    await expect(plan(page).locator('#selGroup option[value="chantier"]')).toHaveCount(0);
});

test('le detail d une cellule nomme le projet du chantier', async ({ page }) => {
    await ouvrirPlan(page, DOC_CIBLE);

    await grille(page).locator('td.cell:has(.v)').first().click();

    await expect(plan(page).locator('#pBody')).toContainText('Portail habilitations');
    await expect(plan(page).locator('#pBody')).not.toContainText('Sans projet');
});

// Le projet affiche est deduit du chantier : le renvoyer en base ecrirait un rattachement que le
// metier n'a pas saisi, et parentTask ne designe plus une tache.
test('modifier une allocation n ecrit ni le projet ni le rattachement', async ({ page }) => {
    await ouvrirPlan(page, DOC_CIBLE);

    await grille(page).locator('td.cell:has(.v)').first().click();
    const alloc = plan(page).locator('#pBody input[name="alloc"]').first();
    await alloc.fill('12');
    await alloc.blur();

    await expect.poll(() => tacheEnBase(page, 1)).toEqual({ projet: 0, chantier: 1, charges: '[{"teamId":1,"heures":12}]' });
});
