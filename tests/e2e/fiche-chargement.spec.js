'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Ce que la fiche lit, et ce qu'elle dit quand la lecture se passe mal. Une sélection ne change que
// la ligne affichée : relire tout le document à chaque clic coûtait sept allers-retours pour rendre
// les mêmes données.

const DATALAB = 2;

const compterLectures = (page) => page.evaluate(() => {
    window.__lectures = [];
    const vraie = window.grist.docApi.fetchTable.bind(window.grist.docApi);
    window.grist.docApi.fetchTable = (nom) => { window.__lectures.push(nom); return vraie(nom); };
});

test('changer de projet ne relit que la table des projets', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);
    await compterLectures(page);

    await page.evaluate(() => charger({ id: 1 }));

    expect(await page.evaluate(() => window.__lectures)).toEqual(['Projects']);
});

// Grist ne notifie que la table du widget : une modification ailleurs demande une relecture.
test('une modification des tables recharge tout', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);
    await compterLectures(page);

    await page.evaluate(() => charger({ id: 2 }, true));

    const lues = await page.evaluate(() => window.__lectures);
    expect(lues).toContain('Tasks');
    expect(lues).toContain('Chantiers');
    expect(lues).toContain('Team');
});

test('une lecture sans reponse finit par nommer la table qui manque', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB, { attendre: '.fiche', bloquer: 'Tasks' });

    await expect(page.locator('.fiche-message')).toContainText('En attente de Grist', { timeout: 15000 });
    await expect(page.locator('.fiche-message')).toContainText('Tasks');
});

// Un refus de droits donnait le même écran qu'une donnée absente : « Aucun chantier n'est rattaché
// à ce projet », affirmation fausse que rien ne distinguait du cas normal.
test('une lecture refusee se dit, au lieu de passer pour une absence de donnees', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB, { refuser: 'Chantiers' });

    await expect(page.locator('.fiche-refus')).toContainText('Lecture refusée sur : Chantiers');
    await expect(page.locator('.fiche-route')).toContainText('Aucun chantier');
});

// Une table que le document ne déclare pas n'est pas demandée : Grist journalise sinon sa propre
// erreur dans la console, avant que notre garde ne la voie.
test('une table absente du schema n est pas demandee', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Categorie_de_projet;
    doc.Projects.columns.Categorie = { type: 'Choice' };
    doc.Projects.records.find((p) => p.id === DATALAB).Categorie = 'Projet';
    await D.ouvrirFiche(page, doc, DATALAB);
    await compterLectures(page);

    await page.evaluate(() => charger({ id: 2 }, true));

    expect(await page.evaluate(() => window.__lectures)).not.toContain('Categorie_de_projet');
});
