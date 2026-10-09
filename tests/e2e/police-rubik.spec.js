'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Rubik, police de l'AP-HP, arrive avec le widget : aucune requête vers un serveur de polices.

async function rubikAppliquee(page, selecteur) {
    await expect.poll(() => page.evaluate(() => document.fonts.check('16px Rubik'))).toBe(true);
    await expect.poll(() => page.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '').trim() : null;
    }, selecteur)).toBe('Rubik');
}

function surveillerPolices(page) {
    const appels = [];
    page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)|\.woff2?(\?|$)/.test(r.url())) appels.push(r.url()); });
    return appels;
}

test('la fiche s affiche en Rubik, sans appel exterieur', async ({ page }) => {
    const appels = surveillerPolices(page);
    await D.ouvrirFiche(page, null, 2);
    await rubikAppliquee(page, '.fiche-titre');
    await rubikAppliquee(page, '.fiche');
    expect(appels).toEqual([]);
});

test('le Gantt s affiche en Rubik, volet compris', async ({ page }) => {
    const appels = surveillerPolices(page);
    await D.ouvrirGantt(page);
    await rubikAppliquee(page, 'body');
    await D.ouvrirVolet(page, 'Socle technique');
    await rubikAppliquee(page, '#taskTitle');
    expect(appels).toEqual([]);
});
