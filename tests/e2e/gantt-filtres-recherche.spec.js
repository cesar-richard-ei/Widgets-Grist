'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Les menus de filtre se lisent et se parcourent au clavier : options triées, champ de recherche
// au sommet, et pour les personnes un regroupement par domaine.

const ouvrir = async (page, dropdown, menu) => {
    await page.locator('#' + dropdown + ' .filter-btn').click();
    await page.waitForSelector('#' + menu + '.open');
};

const visibles = (page, menu, selecteur) => page.locator('#' + menu + ' ' + selecteur)
    .evaluateAll((els) => els.filter((e) => e.style.display !== 'none').map((e) => e.textContent.trim()));

test('les projets sont proposes dans l ordre alphabetique', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreProjet', 'menuProjet');

    expect(await visibles(page, 'menuProjet', '.filter-option[data-filtre]'))
        .toEqual(['Datalab', 'Portail habilitations']);
});

test('les domaines aussi', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreDomaine', 'menuDomaine');

    expect(await visibles(page, 'menuDomaine', '.filter-option[data-filtre]'))
        .toEqual(['Données', 'Expérience', 'Pilotage', 'Socle technique']);
});

test('les responsables sont groupes par domaine, chaque groupe annonce le sien', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreResponsable', 'menuResponsable');

    const contenu = await page.locator('#menuResponsable .fm-group-label, #menuResponsable .filter-option[data-filtre]')
        .allTextContents();

    expect(contenu.map((t) => t.trim())).toEqual([
        'Données', 'David Sarr',
        'Expérience', 'Chloé Roux',
        'Pilotage', 'Alice Martin',
        'Socle technique', 'Bruno Klein'
    ]);
});

test('une personne sans domaine ferme la liste sous son propre separateur', async ({ page }) => {
    const doc = D.documentCible();
    doc.Team.records.find((m) => m.id === 1).Domaine = null;
    await D.ouvrirGantt(page, doc);
    await ouvrir(page, 'filtreResponsable', 'menuResponsable');

    const contenu = await page.locator('#menuResponsable .fm-group-label, #menuResponsable .filter-option[data-filtre]')
        .allTextContents();

    expect(contenu.map((t) => t.trim()).slice(-2)).toEqual(['Sans domaine', 'Alice Martin']);
});

test('taper dans le champ ne garde que ce qui correspond, accents ignores', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreResponsable', 'menuResponsable');

    await page.locator('#menuResponsable .fm-search').fill('chloe');

    expect(await visibles(page, 'menuResponsable', '.filter-option[data-filtre]')).toEqual(['Chloé Roux']);
    expect(await visibles(page, 'menuResponsable', '.fm-group-label')).toEqual(['Expérience']);
});

test('une recherche sans reponse le dit', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreResponsable', 'menuResponsable');

    await page.locator('#menuResponsable .fm-search').fill('zzz');

    expect(await visibles(page, 'menuResponsable', '.filter-option[data-filtre]')).toEqual([]);
    await expect(page.locator('#menuResponsable .fm-vide')).toBeVisible();
});

test('ouvrir un menu pose le curseur dans son champ de recherche', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreProjet', 'menuProjet');

    expect(await page.evaluate(() => document.activeElement.className)).toContain('fm-search');
});

test('entree coche la premiere option encore visible', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreResponsable', 'menuResponsable');

    await page.locator('#menuResponsable .fm-search').fill('sarr');
    await page.locator('#menuResponsable .fm-search').press('Enter');

    expect(await page.evaluate(() => filters.responsable)).toEqual([4]);
});

test('echap referme le menu', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreProjet', 'menuProjet');

    await page.locator('#menuProjet .fm-search').press('Escape');

    await expect(page.locator('#menuProjet')).not.toHaveClass(/open/);
});

// Cocher une option ne redessine pas le menu : la recherche en cours doit survivre au choix, sinon
// on ne peut pas en cocher deux d'affilée.
test('la recherche survit au choix d une option', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrir(page, 'filtreResponsable', 'menuResponsable');

    await page.locator('#menuResponsable .fm-search').fill('r');
    await page.locator('#menuResponsable .filter-option[data-filtre]', { hasText: 'Chloé Roux' }).click();

    await expect(page.locator('#menuResponsable .fm-search')).toHaveValue('r');
    await expect(page.locator('#menuResponsable')).toHaveClass(/open/);
});
