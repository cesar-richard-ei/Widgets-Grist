'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Ce que le Gantt lit à l'ouverture, et comment. Les tables ne dépendent pas les unes des autres :
// les lire l'une après l'autre coûtait autant d'allers-retours au chargement comme à chaque retour
// sur le widget.

const suivreLectures = () => ({
    poser: () => {
        window.__lectures = [];
        window.__enVol = 0;
        window.__maxEnVol = 0;
        const armer = setInterval(() => {
            if (!window.grist || !window.grist.docApi || window.grist.docApi.__suivi) return;
            const vraie = window.grist.docApi.fetchTable.bind(window.grist.docApi);
            window.grist.docApi.fetchTable = (nom) => {
                window.__lectures.push(nom);
                window.__enVol++;
                window.__maxEnVol = Math.max(window.__maxEnVol, window.__enVol);
                return vraie(nom).finally(() => { window.__enVol--; });
            };
            window.grist.docApi.__suivi = true;
            clearInterval(armer);
        }, 1);
        setTimeout(() => clearInterval(armer), 3000);
    }
});

test('les tables du document se lisent ensemble', async ({ page }) => {
    await page.addInitScript(suivreLectures().poser);
    await D.ouvrirGantt(page);

    const mesure = await page.evaluate(async () => {
        window.__lectures = []; window.__enVol = 0; window.__maxEnVol = 0;
        await loadAllData();
        return { lectures: window.__lectures, simultanees: window.__maxEnVol };
    });

    expect(mesure.lectures).toContain('Tasks');
    expect(mesure.lectures).toContain('Chantiers');
    expect(mesure.simultanees).toBeGreaterThanOrEqual(4);
});

// Demander une table que le document ne porte pas fait journaliser une erreur par Grist, avant même
// que notre garde ne la voie : une ligne rouge à chaque ouverture.
test('une table absente du schema n est pas demandee', async ({ page }) => {
    const doc = D.documentCible();
    delete doc.Categorie_de_projet;
    doc.Projects.columns.Categorie = { type: 'Choice' };
    await page.addInitScript(() => {
        window.__lectures = [];
        const armer = setInterval(() => {
            if (!window.grist || !window.grist.docApi || window.grist.docApi.__suivi) return;
            const vraie = window.grist.docApi.fetchTable.bind(window.grist.docApi);
            window.grist.docApi.fetchTable = (nom) => { window.__lectures.push(nom); return vraie(nom); };
            window.grist.docApi.__suivi = true;
            clearInterval(armer);
        }, 1);
    });

    await D.ouvrirGantt(page, doc);

    expect(await page.evaluate(() => window.__lectures)).not.toContain('Categorie_de_projet');
});

test('a l ouverture, les tables du schema se lisent ensemble', async ({ page }) => {
    await page.addInitScript(suivreLectures().poser);
    await D.ouvrirGantt(page);

    expect(await page.evaluate(() => window.__maxEnVol)).toBeGreaterThanOrEqual(3);
});

// Grist ne notifie que la table du widget : seule Tasks peut avoir changé. Les autres tables se
// relisent au retour sur le widget.
test('une notification de Grist ne relit que les taches', async ({ page }) => {
    await page.addInitScript(suivreLectures().poser);
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    await page.evaluate(() => { window.__lectures = []; });
    await page.evaluate(() => grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', 3, { titre: 'Recette finale' }]]));

    await expect(D.ligne(page, 'Recette finale')).toBeVisible();
    expect(await page.evaluate(() => window.__lectures)).toEqual(['Tasks']);
});

test('une relecture qui ne trouve rien de neuf ne redessine pas', async ({ page }) => {
    await D.ouvrirGantt(page);

    const rendus = await page.evaluate(async () => {
        let n = 0;
        const original = window.render;
        window.render = function () { n++; return original.apply(this, arguments); };
        await loadAllData();
        window.render = original;
        return n;
    });
    expect(rendus).toBe(0);
});

test('la bulle d une ligne et d une barre suit le survol', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);
    const bulle = page.locator('#tooltip');

    await D.ligne(page, 'Cadrage des outils').hover();
    await expect(bulle).toHaveClass(/visible/);
    await expect(bulle.locator('.tooltip-title')).toHaveText('Cadrage des outils');

    await page.mouse.move(2, 2);
    await expect(bulle).not.toHaveClass(/visible/);

    const id = await D.ligne(page, 'Recette').getAttribute('data-id');
    await page.locator('#timelineGrid .gantt-bar[data-id="' + id + '"]').hover();
    await expect(bulle.locator('.tooltip-title')).toHaveText('Recette');
});
