'use strict';

const { test, expect } = require('./harness.js');

// Viewport etroit pour forcer le depassement horizontal de la timeline.
test.use({ viewport: { width: 720, height: 640 } });

const scrollLeft = (sc) => sc.evaluate((el) => el.scrollLeft);

test("l'ouverture cale le debut du mois courant a gauche, pas la colonne du jour", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    const line = gantt.locator('#timelineGrid .today-line');
    await expect(line).toHaveCount(1);

    // Aujourd'hui est dans le 1er mois du semestre courant : le debut de mois est deja au bord.
    await expect.poll(() => scrollLeft(sc)).toBe(0);

    // Du coup la ligne "aujourd'hui" n'est PAS collee au bord (elle est plus loin dans le mois) :
    // c'est la difference avec l'ancien comportement qui calait la colonne du jour.
    const scBox = await sc.boundingBox();
    const lineBox = await line.boundingBox();
    expect(lineBox.x - scBox.x).toBeGreaterThan(30);
});

test("le bouton Aujourd'hui recale la vue", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    await sc.evaluate((el) => { el.scrollLeft = 250; });
    expect(await scrollLeft(sc)).toBeGreaterThan(0);

    await gantt.locator('button:has-text("Aujourd")').click();
    await expect.poll(() => scrollLeft(sc)).toBe(0);
});

test("changer d'echelle de vue recale", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    await sc.evaluate((el) => { el.scrollLeft = 250; });
    expect(await scrollLeft(sc)).toBeGreaterThan(0);

    await gantt.locator('.view-controls .btn[data-view="year"]').click();
    await expect.poll(() => scrollLeft(sc)).toBe(0);
});
