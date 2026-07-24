'use strict';

const { test, expect } = require('./harness.js');

// Viewport etroit pour forcer le depassement horizontal de la timeline : sinon toute la periode
// tient dans la vue et il n'y a rien a caler.
test.use({ viewport: { width: 720, height: 640 } });

test("a l'ouverture, la colonne du jour est calee sur le bord gauche", async ({ gantt }) => {
    const sc = gantt.locator('#timelineScroll');
    const line = gantt.locator('#timelineGrid .today-line');
    await expect(line).toHaveCount(1);

    // Le scroll horizontal a bien ete applique (la vue ne demarre plus au debut de la periode).
    const scrollLeft = await sc.evaluate(el => el.scrollLeft);
    expect(scrollLeft).toBeGreaterThan(0);

    // La ligne "now" est proche du bord gauche de la timeline (marge d'environ une cellule).
    const scBox = await sc.boundingBox();
    const lineBox = await line.boundingBox();
    const rel = lineBox.x - scBox.x;
    expect(rel).toBeGreaterThanOrEqual(0);
    expect(rel).toBeLessThan(120);
});
