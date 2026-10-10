'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Le bouton d'export imprime la fiche sur une page A4 paysage, mise en page comme à l'écran.

const fiche = (page) => page.locator('.fiche');
const bouton = (page) => fiche(page).locator('.fiche-export');
const DATALAB = 2;          // Projet
const PORTAIL = 1;          // Produit

function avecCategorie(id, categorie) {
    const doc = D.documentCible();
    doc.Projects.records.find((p) => p.id === id).Categorie = categorie;
    return doc;
}

test('le bouton d export est dans l en-tete de la fiche projet', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);
    await expect(fiche(page).locator('.fiche-entete .fiche-export')).toHaveText('Exporter en PDF');
});

test('la fiche produit a son bouton d export', async ({ page }) => {
    await D.ouvrirFiche(page, avecCategorie(PORTAIL, 1), PORTAIL);
    await expect(bouton(page)).toHaveCount(1);
});

test('la fiche offre de service a son bouton d export', async ({ page }) => {
    await D.ouvrirFiche(page, avecCategorie(DATALAB, 3), DATALAB);
    await expect(bouton(page)).toHaveCount(1);
});

test('une fiche a venir n a pas de bouton d export', async ({ page }) => {
    await D.ouvrirFiche(page, avecCategorie(PORTAIL, 4), PORTAIL, { attendre: '.fiche-bientot' });
    await expect(bouton(page)).toHaveCount(0);
});

test('en impression, bouton et chevrons disparaissent et le pied se montre', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);
    await page.evaluate(() => document.documentElement.classList.add('impression'));
    await page.emulateMedia({ media: 'print' });

    await expect(bouton(page)).toBeHidden();
    await expect(fiche(page).locator('.fiche-chevron').first()).toBeHidden();
    await expect(fiche(page).locator('.fiche-pied')).toBeAttached();
});

test('hors impression, le pied reste cache', async ({ page }) => {
    await D.ouvrirFiche(page, null, DATALAB);
    await expect(fiche(page).locator('.fiche-pied')).toBeAttached();
    await expect(fiche(page).locator('.fiche-pied')).toBeHidden();
});

test('en mode impression, un widget etroit et sombre garde trois colonnes sur fond clair', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await D.ouvrirFiche(page, null, DATALAB);
    await page.evaluate(() => document.documentElement.classList.add('impression'));

    const style = await page.evaluate(() => ({
        sens: getComputedStyle(document.querySelector('.fiche-cadrage')).flexDirection,
        fond: getComputedStyle(document.body).backgroundColor,
        corps: getComputedStyle(document.querySelector('.fiche-corps')).maxHeight
    }));
    expect(style).toEqual({ sens: 'row', fond: 'rgb(255, 255, 255)', corps: 'none' });
});
