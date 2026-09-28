'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Ce que la barre d'outils du Gantt propose, et dans quel ordre.

test('la barre d outils ne propose ni tri, ni ajustement de la vue, ni export', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#sortSelect')).toHaveCount(0);
    await expect(page.locator('.header-center .btn', { hasText: 'Ajuster' })).toHaveCount(0);
    await expect(page.locator('#moreDropdown')).toHaveCount(0);
});

test('les vues temporelles vont du mois à l année, sans la semaine', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('.view-controls .btn')).toHaveText(['Mois', 'Trim', '6M', 'An']);
});

// Les flèches encadrent la période affichée, pas le bouton du jour : c'est la période qu'elles
// déplacent.
test('la gauche de la barre porte le jour, puis la periode entre ses fleches', async ({ page }) => {
    await D.ouvrirGantt(page);

    const gauche = await page.locator('.header-left > *').evaluateAll(
        (els) => els.map((e) => e.id || e.textContent.trim()));

    expect(gauche).toEqual(['badgeVersion', "Aujourd'hui", '◀', 'currentPeriod', '▶']);
});

test('la droite de la barre porte les trois filtres, la couleur puis l ajout', async ({ page }) => {
    await D.ouvrirGantt(page);

    const droite = await page.locator('.header-right > *').evaluateAll((els) => els.map((e) => e.id));

    expect(droite).toEqual(['libelleFiltres', 'filtreProjet', 'filtreDomaine', 'filtreResponsable', 'zoneCouleur', 'zoneAjout']);
});

test('le libelle des filtres est ecrit comme la periode', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#libelleFiltres')).toHaveText('Filtres :');

    const polices = await page.evaluate(() => ['#libelleFiltres', '#currentPeriod'].map((sel) => {
        const s = getComputedStyle(document.querySelector(sel));
        return [s.fontFamily, s.fontSize, s.fontWeight, s.letterSpacing].join('|');
    }));

    expect(polices[0]).toBe(polices[1]);
});

test('le dropdown unique de filtres a laisse la place a trois menus independants', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#filterGantt')).toHaveCount(0);
    await expect(page.locator('#filterAllMenu')).toHaveCount(0);
    await expect(page.locator('.header-right .filter-btn')).toHaveText(['Projet', 'Domaine', 'Responsable']);
});

test('ouvrir un menu de filtre referme le precedent', async ({ page }) => {
    await D.ouvrirGantt(page);

    await page.locator('#filtreProjet .filter-btn').click();
    await expect(page.locator('#menuProjet')).toHaveClass(/open/);

    await page.locator('#filtreDomaine .filter-btn').click();

    await expect(page.locator('#menuProjet')).not.toHaveClass(/open/);
    await expect(page.locator('#menuDomaine')).toHaveClass(/open/);
});

test('la priorite n est plus un filtre du gantt', async ({ page }) => {
    await D.ouvrirGantt(page);

    expect(await page.evaluate(() => Object.keys(filters).sort())).toEqual(['domaine', 'project', 'responsable']);
    await expect(page.locator('.filter-option[data-filtre="priority"]')).toHaveCount(0);
});

test('le filtre Projet ne porte plus de pastille de couleur', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.locator('#filtreProjet .filter-btn').click();

    await expect(page.locator('#menuProjet .filter-option').first()).toBeVisible();
    await expect(page.locator('#menuProjet .dot')).toHaveCount(0);
});

test('le selecteur de couleur nomme le mode sans le mot Couleur et se signale actif', async ({ page }) => {
    await D.ouvrirGantt(page);

    const libelles = await page.locator('#colorSelect option').allTextContents();
    expect(libelles.length).toBeGreaterThan(0);
    libelles.forEach((l) => expect(l).not.toMatch(/couleur/i));
    await expect(page.locator('#colorSelect')).toHaveCSS('border-top-color', 'rgb(62, 93, 231)');
});

test('les menus de filtre font 320 px de large', async ({ page }) => {
    await D.ouvrirGantt(page);

    for (const filtre of ['filtreProjet', 'filtreDomaine', 'filtreResponsable']) {
        await page.locator('#' + filtre + ' .filter-btn').click();
        const menu = page.locator('#' + filtre + ' .filter-menu');
        await expect(menu).toHaveClass(/open/);
        expect(await menu.evaluate((m) => m.getBoundingClientRect().width)).toBe(320);
    }
});

// Un nom de projet sur deux lignes garde sa case au niveau de la première : centrée sur ses
// minuscules, comme l'œil lit la ligne, et non sur la hauteur de ligne qui la ferait remonter.
test('la case du filtre projet est au niveau de la premiere ligne du nom', async ({ page }) => {
    const doc = D.documentCible();
    doc.Projects.records[0].nom = '[A cadrer] Développement de la stack technique de la base centrale et de ses entrepôts';
    await D.ouvrirGantt(page, doc);
    await page.locator('#filtreProjet .filter-btn').click();

    const option = page.locator('#menuProjet .filter-option', { hasText: 'stack technique' });
    const mesure = await option.evaluate((opt) => {
        const texte = Array.from(opt.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
        const range = document.createRange();
        range.selectNodeContents(texte);
        const lignes = range.getClientRects().length;
        // Repère posé devant le texte : son bas est la ligne de base, sa hauteur celle des minuscules.
        const repere = document.createElement('span');
        repere.style.cssText = 'display:inline-block;width:0;height:1ex;vertical-align:baseline';
        opt.insertBefore(repere, texte);
        const r = repere.getBoundingClientRect();
        repere.remove();
        const c = opt.querySelector('input').getBoundingClientRect();
        return { lignes, ecart: Math.abs((c.top + c.height / 2) - (r.bottom - r.height / 2)) };
    });

    expect(mesure.lignes).toBeGreaterThan(1);
    expect(mesure.ecart).toBeLessThanOrEqual(0.75);
});

// Tous les contrôles de la barre ont la même hauteur et le même alignement, sans exception.
for (const largeur of [1440, 500]) test('tous les controles de la barre ont la meme hauteur et le meme alignement a ' + largeur + ' px', async ({ page }) => {
    await D.ouvrirGantt(page, null, { largeur: largeur });

    const boites = await page.evaluate(() => ['.header-left .btn', '.btn-nav', '.view-controls', '.filter-btn', '#colorSelect', '#btnAjouter']
        .map((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { sel, haut: b.top, hauteur: b.height }; }));

    boites.forEach((b) => {
        expect(b.hauteur, b.sel).toBe(boites[0].hauteur);
        expect(b.haut, b.sel).toBe(boites[0].haut);
    });
    const fleche = await page.locator('.btn-nav').first().evaluate((e) => e.getBoundingClientRect());
    expect(fleche.width).toBe(fleche.height);
});
