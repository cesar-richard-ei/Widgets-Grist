'use strict';

const path = require('path');
const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');
const WIDGETS = ['gantt', 'kanban', 'calendar', 'dashboard', 'plan'];

// Ce que le widget fait quand le document se comporte mal : lectures lentes, table refusée, Grist
// absent. La règle qui tient tout : le repli sur les données d'exemple répond à une **absence de
// Grist**, jamais à une lenteur. Sur un poste modeste les lectures dépassent le délai du filet, et
// remplacer alors les données réelles par celles de la démo coupe silencieusement les écritures.

async function preparer(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
}

/** Grist répond au handshake, mais chaque lecture de table traîne. */
const simulacreLent = (page, ms, doc) => page.addInitScript((cfg) => {
    window.grist = window.createFakeGrist(cfg.doc || {});
    const vrai = window.grist.docApi.fetchTable;
    window.grist.docApi.fetchTable = async function (nom) {
        await new Promise((r) => setTimeout(r, cfg.ms));
        return vrai.call(this, nom);
    };
}, { ms, doc });

/** Grist absent : le handshake ne répond jamais, comme un widget ouvert hors de son iframe. */
const simulacreMuet = (page) => page.addInitScript(() => {
    window.grist = window.createFakeGrist({});
    window.grist.ready = () => new Promise(() => {});
});

/** Compte les lectures d'une table depuis l'ouverture : le simulacre les journalise. */
const lectures = (page, table) => page.evaluate((t) => window.grist._fetches.filter((n) => n === t).length, table);

test('le widget construit son schéma et sème de quoi démarrer', async ({ page }) => {
    await preparer(page);
    await page.addInitScript(() => { window.grist = window.createFakeGrist({}); });
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');

    const tables = await page.evaluate(() => window.grist.docApi.listTables());
    expect(tables.sort()).toEqual(['Projects', 'Tasks', 'Team']);
    await expect(page.locator('.demo-badge')).toHaveCount(0);
});

// Renommer le libellé d'une colonne régénère son identifiant tant qu'elle n'est pas déliée, et le
// widget, qui lit par identifiant, ne retrouve plus rien.
test('les colonnes du widget sont déliées de leur libellé', async ({ page }) => {
    await preparer(page);
    await page.addInitScript(() => { window.grist = window.createFakeGrist({}); });
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');

    const toutesDeliees = await page.evaluate(async () => {
        const cols = await window.grist.docApi.fetchTable('_grist_Tables_column');
        return cols.untieColIdFromLabel.every((v, i) => v === true || String(cols.colId[i]).startsWith('grist') || String(cols.colId[i]) === 'manualSort');
    });
    expect(toutesDeliees).toBe(true);
});

test('chaque table n est lue qu une fois à l ouverture', async ({ page }) => {
    await preparer(page);
    await page.addInitScript((doc) => { window.grist = window.createFakeGrist(doc); }, D.documentCible());
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');

    for (const table of ['Tasks', 'Team', 'Projects', '_grist_Tables', '_grist_Tables_column']) {
        expect(await lectures(page, table), table).toBeLessThanOrEqual(1);
    }
});

for (const widget of WIDGETS) {
    test('des lectures lentes ne déclenchent pas la démonstration dans ' + widget, async ({ page }) => {
        await preparer(page);
        await simulacreLent(page, 4000, D.documentCible());
        await page.goto('http://localhost:3001/tasks_app/' + widget + '.html');
        await page.waitForTimeout(3500);

        await expect(page.locator('.demo-badge')).toHaveCount(0);
    });
}

test('sans réponse de Grist, la démonstration prend le relais', async ({ page }) => {
    await preparer(page);
    await simulacreMuet(page);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');

    await expect(page.locator('.demo-badge')).toHaveCount(1, { timeout: 8000 });
});

test('une table refusée est nommée à l écran, sans masquer le reste', async ({ page }) => {
    await D.ouvrirGantt(page, null, { refuser: 'Team' });

    const alerte = page.locator('#alerteTables');
    await expect(alerte).toBeVisible();
    await expect(alerte).toContainText('Team');
    await expect(D.ligne(page, 'Socle technique')).toHaveCount(1);
});

test('une table absente du document ne déclenche pas d alerte', async ({ page }) => {
    await D.ouvrirGantt(page, null, { refuser: 'Categorie_de_projet_absente' });

    await expect(page.locator('#alerteTables')).toBeHidden();
});

test('sans refus, aucune alerte', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#alerteTables')).toBeHidden();
});

for (const [valeur, visible] of [['true', true], ['oui', false], [null, false]]) {
    test('la version s affiche seulement si le réglage vaut true (' + String(valeur) + ')', async ({ page }) => {
        await D.ouvrirGantt(page, null, { reglages: valeur === null ? {} : { taskflow_show_version: valeur } });

        const badge = page.locator('#badgeVersion');
        if (!visible) return expect(await badge.isVisible()).toBe(false);

        await expect(badge).toBeVisible();
        // Hors déploiement, le marqueur n'a pas été remplacé : la copie locale l'annonce.
        await expect(badge).toHaveText('local');
        const enTete = await page.evaluate(() => {
            const b = document.getElementById('badgeVersion').getBoundingClientRect();
            return b.left < document.getElementById('sortSelect').getBoundingClientRect().left && b.top < 80;
        });
        expect(enTete).toBe(true);
    });
}
