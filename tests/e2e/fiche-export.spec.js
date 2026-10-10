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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// window.print bloque jusqu'à la fermeture de la boîte : bouchonné, il relève l'état de la fiche.
async function bouchonnerImpression(page) {
    await page.addInitScript(() => {
        window.__impressions = [];
        window.print = () => {
            const racine = document.getElementById('fiche');
            const img = racine.querySelector('img.fiche-visuel');
            window.__impressions.push({
                mode: document.documentElement.classList.contains('impression'),
                zoom: Number(racine.style.zoom || 1), largeur: parseFloat(racine.style.width),
                titre: document.title, pied: racine.querySelector('.fiche-pied').textContent,
                visuel: img ? img.naturalWidth : null
            });
        };
    });
}
const impressions = (page) => page.evaluate(() => window.__impressions);
const finImpression = (page) => page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

function avecVisuel() {
    const doc = D.documentCible();
    doc.Projects.columns.Visuel = { type: 'Attachments', label: 'Visuel' };
    doc.Projects.records.find((p) => p.id === DATALAB).Visuel = ['L', 7];
    return doc;
}

test('le bouton imprime la fiche en mode impression, titre et pied poses', async ({ page }) => {
    await bouchonnerImpression(page);
    await D.ouvrirFiche(page, null, DATALAB);
    const titre = await page.title();
    await bouton(page).click();

    await expect.poll(() => impressions(page).then((l) => l.length)).toBe(1);
    const [vue] = await impressions(page);
    expect(vue.mode).toBe(true);
    expect(vue.titre).toMatch(/^Fiche - Datalab - \d{4}-\d{2}-\d{2}$/);
    expect(vue.pied).toMatch(/^Fiche éditée le \d{2}\/\d{2}\/\d{4}$/);
    expect(vue.largeur * vue.zoom).toBeCloseTo(1046, 0);

    await finImpression(page);
    await expect(page.locator('html')).not.toHaveClass(/impression/);
    expect(await page.title()).toBe(titre);
    expect(await page.evaluate(() => document.getElementById('fiche').getAttribute('style') || '')).not.toMatch(/zoom|width/);
    await expect(bouton(page)).toBeEnabled();
});

test('l impression attend le visuel', async ({ page }) => {
    await page.route('**/__grist/attachments/**', async (route) => {
        await new Promise((r) => setTimeout(r, 800));
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    });
    await bouchonnerImpression(page);
    await D.ouvrirFiche(page, avecVisuel(), DATALAB);
    await bouton(page).click();

    await expect.poll(() => impressions(page).then((l) => l.length)).toBe(1);
    expect((await impressions(page))[0].visuel).toBe(1);
});

test('un visuel en erreur n empeche pas l impression', async ({ page }) => {
    await page.route('**/__grist/attachments/**', (route) => route.abort());
    await bouchonnerImpression(page);
    await D.ouvrirFiche(page, avecVisuel(), DATALAB);
    await bouton(page).click();

    await expect.poll(() => impressions(page).then((l) => l.length), { timeout: 8000 }).toBe(1);
});

test('un double clic n imprime qu une fois', async ({ page }) => {
    await bouchonnerImpression(page);
    await D.ouvrirFiche(page, null, DATALAB);
    await page.evaluate(() => { const b = document.querySelector('.fiche-export'); b.click(); b.click(); });

    await expect.poll(() => impressions(page).then((l) => l.length)).toBe(1);
    await page.waitForTimeout(300);
    expect((await impressions(page)).length).toBe(1);
});
