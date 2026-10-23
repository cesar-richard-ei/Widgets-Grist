'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Le volet n'écrit que les champs qu'on y a modifiés : deux personnes qui saisissent chacune un
// champ différent de la même ligne ne s'écrasent plus.

const ecrireAilleurs = (page, table, id, valeurs) =>
    page.evaluate(([t, i, v]) => grist.docApi.applyUserActions([['UpdateRecord', t, i, v]]), [table, id, valeurs]);
const champChantier = (page, id, colonne) => page.evaluate(({ id, colonne }) =>
    grist.docApi.fetchTable('Chantiers').then((t) => t[colonne][t.id.indexOf(id)]), { id, colonne });

test('une saisie dans le volet laisse le statut change ailleurs entre-temps', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);
    await D.ouvrirVolet(page, 'Cadrage des outils');

    await ecrireAilleurs(page, 'Tasks', 1, { statut: 'done' });
    await page.locator('#taskDescription').fill('Cadrage à valider avec le métier');
    await page.locator('#taskDescription').blur();

    await expect.poll(() => D.champTache(page, 1, 'description')).toBe('Cadrage à valider avec le métier');
    expect(await D.champTache(page, 1, 'statut')).toBe('done');
});

test('renommer un chantier laisse sa description changee ailleurs entre-temps', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    await ecrireAilleurs(page, 'Chantiers', 1, { Description: 'Saisie par une collègue' });
    await page.locator('#taskTitle').fill('Socle technique commun');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => champChantier(page, 1, 'Nom_du_chantier')).toBe('Socle technique commun');
    expect(await champChantier(page, 1, 'Description')).toBe('Saisie par une collègue');
});

test('l ecriture du volet ne porte que le champ modifie', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);
    await D.ouvrirVolet(page, 'Cadrage des outils');
    const avant = await page.evaluate(() => grist._log.length);

    await page.locator('#taskDescription').fill('Nouvelle description');
    await page.locator('#taskDescription').blur();
    await expect.poll(() => D.champTache(page, 1, 'description')).toBe('Nouvelle description');

    const ecrites = await page.evaluate((n) => grist._log.slice(n)
        .filter((a) => a[0] === 'UpdateRecord' && a[1] === 'Tasks').map((a) => Object.keys(a[3])), avant);
    expect(ecrites).toEqual([['description']]);
});
