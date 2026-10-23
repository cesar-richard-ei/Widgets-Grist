'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// La fiche porte son propre sélecteur de projet et retient le dernier choisi : au retour sur la
// page, Grist remet son curseur sur la première ligne, ou sur aucune.

const choix = (page) => page.locator('#choixProjet');
const titre = (page) => page.locator('.fiche-titre');
const curseurs = (page) => page.evaluate(() => grist._log.filter((l) => l[0] === 'setCursorPos').map((l) => l[1].rowId));

test('le selecteur liste les projets du document', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible());

    await expect(choix(page).locator('option:not([value=""])')).toHaveText(['Portail habilitations', 'Datalab']);
    await expect(page.locator('.fiche-accueil')).toBeVisible();
});

test('choisir un projet ouvre sa fiche et y place le curseur', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible());

    await choix(page).selectOption({ label: 'Datalab' });

    await expect(titre(page)).toHaveText('Datalab');
    expect(await curseurs(page)).toContain(2);
});

test('au retour sur la page, la fiche rouvre le dernier projet choisi', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible());
    await choix(page).selectOption({ label: 'Datalab' });
    await expect(titre(page)).toHaveText('Datalab');

    await page.reload();

    await expect(titre(page)).toHaveText('Datalab');
    await expect(choix(page)).toHaveValue('2');
});

test('le curseur remis sur la premiere ligne ne remplace pas le dernier choix', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible(), 1);
    await expect(titre(page)).toHaveText('Portail habilitations');
    await choix(page).selectOption({ label: 'Datalab' });
    await expect(titre(page)).toHaveText('Datalab');

    await page.reload();

    await expect(titre(page)).toHaveText('Datalab');
    expect(await curseurs(page)).toEqual([2]);
});

test('un projet choisi ailleurs sur la page est repris et retenu', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible(), 1);
    await expect(titre(page)).toHaveText('Portail habilitations');

    await page.evaluate(() => grist.setSelectedRows([2]));
    await expect(titre(page)).toHaveText('Datalab');
    await expect(choix(page)).toHaveValue('2');

    await page.reload();
    await expect(titre(page)).toHaveText('Datalab');
});

test('un projet retenu puis supprime laisse la fiche sur l accueil', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible(), undefined, { reglages: { 'taskflow_fiche_projet:fake-doc': '99' } });

    await expect(page.locator('.fiche-accueil')).toBeVisible();
    await expect(choix(page)).toHaveValue('');
});

test('le selecteur ne part pas a l impression', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible(), 2);
    await expect(titre(page)).toHaveText('Datalab');

    await page.evaluate(() => document.documentElement.classList.add('impression'));
    await expect(page.locator('#ficheChoix')).toBeHidden();
});

// Une section non liée reçoit de Grist un enregistrement vide à l'ouverture.
test('un enregistrement vide envoye par Grist ne chasse pas le projet retenu', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible(), null, { reglages: { 'taskflow_fiche_projet:fake-doc': '2' } });

    await expect(titre(page)).toHaveText('Datalab');
    await expect(choix(page)).toHaveValue('2');
});

test('une lecture refusee le dit et garde le projet retenu', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible(), undefined, { reglages: { 'taskflow_fiche_projet:fake-doc': '2' }, refuser: 'Projects' });

    await expect(page.locator('.fiche-refus')).toContainText('Projects');
    expect(await page.evaluate(() => localStorage.getItem('taskflow_fiche_projet:fake-doc'))).toBe('2');
});

test('une notification de Grist pendant le chargement ne chasse pas le projet choisi', async ({ page }) => {
    await D.ouvrirFiche(page, D.documentCible(), null, { retarder: 50 });
    await expect(page.locator('.fiche-accueil')).toBeVisible();

    await choix(page).selectOption({ label: 'Datalab' });
    await page.evaluate(() => grist.docApi.applyUserActions([['UpdateRecord', 'Projects', 1, { couleur: '#123456' }]]));

    await expect(titre(page)).toHaveText('Datalab');
    await expect(choix(page)).toHaveValue('2');
});
