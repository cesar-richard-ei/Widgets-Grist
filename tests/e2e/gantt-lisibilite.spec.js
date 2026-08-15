'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Tout ce qui s'écrit par-dessus la timeline : titres de barres, noms de jalons, bulle de survol.
// Un libellé posé hors de son élément doit rester entier, opaque et contrasté, dans les deux
// thèmes. La présence dans le DOM ne prouve rien : un parent qui découpe son débordement suffit à
// le rendre invisible, sans qu'aucune assertion classique ne bronche.

const SEUIL_AA = 4.5;

const barre = (page, id) => page.locator('#timelineGrid .gantt-bar[data-id="' + id + '"]');
const bulle = (page) => page.locator('#tooltip');

test('un titre trop long pour sa barre est reporté à côté', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    // La tâche 2 porte un titre bien plus large que sa barre.
    await expect(barre(page, 2).locator('.gantt-bar-external-label')).toBeVisible();
    await expect(barre(page, 2).locator('.gantt-bar-label')).toBeHidden();

    const decoupe = await barre(page, 2).evaluate((b) => {
        const l = b.querySelector('.gantt-bar-external-label').getBoundingClientRect();
        const r = b.getBoundingClientRect();
        return getComputedStyle(b).overflowX === 'hidden' && (l.right > r.right || l.left < r.left);
    });
    expect(decoupe).toBe(false);
});

test('un titre court reste dans sa barre', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    await expect(barre(page, 3).locator('.gantt-bar-label')).toBeVisible();
    await expect(barre(page, 3).locator('.gantt-bar-external-label')).toBeHidden();
});

test('aucun titre affiché dans sa barre n est tronqué', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    const tronques = await page.evaluate(() => Array.from(document.querySelectorAll('#timelineGrid .gantt-bar:not(.parent)'))
        .filter((b) => {
            const dedans = b.querySelector('.gantt-bar-label');
            if (!dedans || getComputedStyle(dedans).display === 'none') return false;
            return dedans.scrollWidth > dedans.clientWidth + 1;
        }).length);
    expect(tronques).toBe(0);
});

test('un titre reporté ne sort jamais de la plage dessinée', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    const deborde = await page.evaluate(() => {
        const grille = document.getElementById('timelineGrid');
        return Array.from(grille.querySelectorAll('.gantt-bar-external-label'))
            .filter((l) => getComputedStyle(l).display !== 'none')
            .some((l) => (l.getBoundingClientRect().right - grille.getBoundingClientRect().left) > grille.scrollWidth + 1);
    });
    expect(deborde).toBe(false);
});

test('le losange d un jalon porte sa couleur', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    const fond = await page.locator('.gantt-milestone .milestone-diamond').first().evaluate((el) => el.style.background);
    expect(fond).not.toBe('');
});

for (const theme of ['light', 'dark']) {
    test('le titre reporté d une barre reste lisible en thème ' + theme, async ({ page }) => {
        await D.ouvrirGantt(page, null, { theme });
        await D.toutDeplier(page);

        const { opaque, ratio } = await D.contraste(page, '.gantt-bar.narrow-bar .gantt-bar-external-label');
        expect(opaque).toBe(true);
        expect(ratio).toBeGreaterThanOrEqual(SEUIL_AA);
    });

    test('le nom d un jalon reste lisible en thème ' + theme, async ({ page }) => {
        await D.ouvrirGantt(page, null, { theme });
        await D.toutDeplier(page);

        const { opaque, ratio } = await D.contraste(page, '.gantt-milestone .milestone-label');
        expect(opaque).toBe(true);
        expect(ratio).toBeGreaterThanOrEqual(SEUIL_AA);
    });

    test('la bulle de survol reste lisible en thème ' + theme, async ({ page }) => {
        await D.ouvrirGantt(page, null, { theme });
        await D.toutDeplier(page);
        await D.ligne(page, 'Socle technique').hover();
        await expect(bulle(page)).toHaveClass(/visible/);

        const mesures = await page.evaluate(() => {
            const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b); };
            const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
            const t = document.getElementById('tooltip');
            const fond = getComputedStyle(t).backgroundColor;
            return {
                titre: ratio(getComputedStyle(t.querySelector('.tooltip-title')).color, fond),
                detail: ratio(getComputedStyle(t.querySelector('.tooltip-row span')).color, fond)
            };
        });
        expect(mesures.titre).toBeGreaterThanOrEqual(SEUIL_AA);
        expect(mesures.detail).toBeGreaterThanOrEqual(SEUIL_AA);
    });
}

test('survoler une ligne montre la même bulle que sur sa barre, et la quitter la referme', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    await D.ligne(page, 'Socle technique').hover();
    await expect(bulle(page)).toHaveClass(/visible/);
    await expect(bulle(page)).toContainText('Socle technique');

    await page.locator('.header').hover();
    await expect(bulle(page)).not.toHaveClass(/visible/);
});

test('la bulle nomme le responsable de la ligne', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    await D.ligne(page, 'Cadrage des outils').hover();

    await expect(bulle(page)).toContainText('Responsable');
    await expect(bulle(page)).toContainText('Bruno Klein');
});
