'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Ce que le Plan écrit, et ce qu'il en dit. Une allocation, une réaffectation ou une
// replanification refusée par Grist doit se voir : l'appliquer d'avance à l'écran laissait
// l'utilisateur devant une valeur que la base n'avait jamais reçue.

const avecCharge = (doc) => {
    const copie = doc || D.documentCible();
    copie.Tasks.records[0].charges = JSON.stringify([{ teamId: 1, heures: 8 }]);
    copie.Tasks.records[0].assignees = ['L', 1];
    return copie;
};

const chargesEnBase = (page, id) => D.cadrePlan(page).evaluate(async (taskId) => {
    const t = await window.grist.docApi.fetchTable('Tasks');
    return t.charges[t.id.indexOf(taskId)];
}, id);

const allouer = (page, id, heures) => D.cadrePlan(page).evaluate(([taskId, h]) => setCharge(taskId, 1, h), [id, heures]);
const toast = (page) => D.plan(page).locator('#toast');

test('une allocation refusee previent et ne reste pas affichee', async ({ page }) => {
    await D.ouvrirPlan(page, avecCharge(), { refuserEcritures: 'Colonne calculee : ecriture refusee' });

    await allouer(page, 1, 40);

    await expect(toast(page)).toContainText('Allocation');
    await expect(toast(page)).toContainText('Colonne calculee');
    expect(await chargesEnBase(page, 1)).toContain('"heures":8');
    expect(await D.cadrePlan(page).evaluate(() => S.tasks.find(t => t.id === 1).charges)).toContain('"heures":8');
});

test('une allocation acceptee part en base', async ({ page }) => {
    await D.ouvrirPlan(page, avecCharge());

    await allouer(page, 1, 40);

    expect(await chargesEnBase(page, 1)).toContain('"heures":40');
    await expect(toast(page)).not.toHaveClass(/show/);
});

// Grist rejette le lot entier dès qu'une colonne est calculée : le Plan élague donc ce qu'il écrit,
// comme le Gantt, plutôt que de perdre l'enregistrement en entier.
test('une colonne calculee est retiree de l ecriture', async ({ page }) => {
    const doc = avecCharge();
    doc.Tasks.columns.tempsPasse = { type: 'Numeric', isFormula: true };
    await D.ouvrirPlan(page, doc);

    const record = await D.cadrePlan(page).evaluate(() => elaguer('Tasks', { charges: '[]', tempsPasse: 4 }));

    expect(Object.keys(record)).toEqual(['charges']);
});

test('une replanification refusee ne deplace pas la tache', async ({ page }) => {
    await D.ouvrirPlan(page, avecCharge(), { refuserEcritures: 'refus' });

    const avant = await D.cadrePlan(page).evaluate(() => S.tasks.find(t => t.id === 1).dateDebut);
    await D.cadrePlan(page).evaluate(() => setDates(1, '2030-01-01', null));

    await expect(toast(page)).toContainText('Replanification');
    expect(await D.cadrePlan(page).evaluate(() => S.tasks.find(t => t.id === 1).dateDebut)).toBe(avant);
});

// Le groupement suit le domaine, l'équipe de rattachement d'une personne. Team.role existe mais
// reste vide sur le document du métier : grouper dessus donnait un unique groupe sans nom.
test('le groupement par domaine range les personnes par equipe', async ({ page }) => {
    const doc = D.documentCible();
    doc.Tasks.records[0].charges = JSON.stringify([{ teamId: 1, heures: 8 }, { teamId: 2, heures: 4 }]);
    doc.Tasks.records[0].assignees = ['L', 1, 2];
    await D.ouvrirPlan(page, doc);

    await D.plan(page).locator('#selGroup').selectOption('domaine');

    // Un groupe par domaine de l'équipe, dans l'ordre alphabétique, y compris ceux qui ne portent
    // pas de charge : c'est une vue de ressources, la marge disponible s'y lit aussi.
    await expect(D.plan(page).locator('tr.grp')).toHaveCount(4);
    await expect(D.plan(page).locator('tr.grp').first()).toContainText('Données');
    await expect(D.plan(page).locator('tr.grp').last()).toContainText('Socle technique');
    await expect(D.plan(page).locator('tr.subr').first()).toContainText('David Sarr');
});

test('sans domaine renseigne, le groupement disparait du menu', async ({ page }) => {
    const doc = D.documentCible();
    doc.Team.records.forEach((m) => { delete m.Domaine; });
    await D.ouvrirPlan(page, doc);

    await expect(D.plan(page).locator('#selGroup option[value="domaine"]')).toHaveCount(0);
});
