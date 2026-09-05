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
