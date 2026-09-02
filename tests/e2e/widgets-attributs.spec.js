'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Les couleurs et les libellés viennent du document, où le métier écrit, et partent dans des
// attributs. escapeHtml passe par textContent, qui laisse les guillemets : sans garde, une valeur
// ferme son attribut et en ouvre un autre. Chaque widget porte sa propre copie de ces helpers.

const PIEGE = 'red;" onmouseover="window.__injecte=1';

const documentPiege = () => {
    const doc = D.documentCible();
    doc.Team.records.forEach((m) => { m.couleur = PIEGE; });
    doc.Projects.records.forEach((p) => { p.couleur = PIEGE; });
    return doc;
};

for (const widget of ['kanban', 'calendar', 'dashboard']) {
    test('sur ' + widget + ', une couleur du document ne sort pas de son attribut', async ({ page }) => {
        await D.ouvrir(page, widget, documentPiege(), { attendre: 'body' });
        await page.waitForTimeout(600);

        const pieges = await page.locator('[onmouseover]').count();
        expect(pieges).toBe(0);
        expect(await page.evaluate(() => window.__injecte)).toBeUndefined();
    });
}
