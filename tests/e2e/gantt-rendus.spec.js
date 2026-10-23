'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Un rendu reconstruit toute la liste et toute la timeline : sur le document du métier, plus de
// 200 ms une fois tout déplié. Les gestes courants n'en demandent qu'un, ou aucun.

async function compterRendus(page) {
    await page.evaluate(() => {
        window.__rendus = 0;
        const original = window.render;
        window.render = function () { window.__rendus++; return original.apply(this, arguments); };
    });
}
const rendus = (page) => page.evaluate(() => window.__rendus);
const finDAnimation = (page) => page.waitForTimeout(600);

test('ouvrir le volet ne redessine le gantt qu une fois', async ({ page }) => {
    await D.ouvrirGantt(page);
    await compterRendus(page);

    await D.ligne(page, 'Socle technique').click();
    await finDAnimation(page);

    expect(await rendus(page)).toBeLessThanOrEqual(1);
    await expect(D.ligne(page, 'Socle technique')).toHaveClass(/selected/);
});

test('fermer le volet ne redessine le gantt qu une fois', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');
    await finDAnimation(page);
    await compterRendus(page);

    await page.evaluate(() => closePanel());
    await finDAnimation(page);

    expect(await rendus(page)).toBeLessThanOrEqual(1);
    await expect(D.ligne(page, 'Socle technique')).not.toHaveClass(/selected/);
});

test('la timeline reprend la largeur laissee par le volet', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');
    await finDAnimation(page);

    const ecart = await page.evaluate(() => {
        const visible = document.getElementById('timelineScroll').getBoundingClientRect().right;
        return Math.abs(visible - document.getElementById('panel').getBoundingClientRect().left);
    });
    expect(ecart).toBeLessThan(2);
});

test('selectionner une ligne surligne ses dependances sans redessiner', async ({ page }) => {
    await D.ouvrirGantt(page, D.avecLiens(D.documentCible(), {
        'Guide de prise en main': { debut: ['Analyse Plateforme Applicative et Cartographie des Usages'] }
    }));
    await D.toutDeplier(page);
    await compterRendus(page);

    await D.ligne(page, 'Guide de prise en main').click();
    await finDAnimation(page);

    await expect(page.locator('.dependencies-layer .dependency-line.highlight')).toHaveCount(1);
    expect(await rendus(page)).toBeLessThanOrEqual(1);
});

test('poser puis retirer un filtre ne redessine qu une fois chacun', async ({ page }) => {
    await D.ouvrirGantt(page);
    await compterRendus(page);

    await page.evaluate(() => toggleFilter('domaine', 'Données'));
    await finDAnimation(page);
    expect(await rendus(page)).toBe(1);

    await page.evaluate(() => clearAllGanttFilters());
    await finDAnimation(page);
    expect(await rendus(page)).toBe(2);
});

test('un rendu ne cree aucun formateur de dates', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    const crees = await page.evaluate(() => {
        let n = 0;
        const Original = Intl.DateTimeFormat;
        Intl.DateTimeFormat = function () { n++; return new Original(...arguments); };
        try { render(); } finally { Intl.DateTimeFormat = Original; }
        return n;
    });
    expect(crees).toBe(0);
});
