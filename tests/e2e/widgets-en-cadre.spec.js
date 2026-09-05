'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Les widgets vivent dans une iframe servie par un autre domaine que la page Grist qui les héberge.
// Les autres tests les chargent au premier plan, ce qui a laissé passer un défaut de la fiche que
// seul ce contexte révélait. Ce fichier exerce chaque widget dans un cadre, sur le même document,
// et vérifie qu'il rend sans erreur.

const CADRE = '<iframe id="f" style="width:1280px;height:760px;border:0" src="http://localhost:3001/tasks_app/__WIDGET__.html?shell=1"></iframe>';

async function ouvrirDansUnCadre(page, widget, doc) {
    // Seules les erreurs venant du cadre comptent : la page hôte charge aussi le widget, le temps
    // que le cadre la remplace, et son initialisation interrompue n'a rien à dire du widget.
    // L'API Grist réelle est coupée pour laisser la place au simulacre : son échec est attendu.
    const erreurs = [];
    page.on('console', (m) => {
        const venuDuCadre = (m.location().url || '').includes('shell=1');
        const attendue = /grist-plugin-api|ERR_FAILED/.test(m.text());
        if (m.type() === 'error' && venuDuCadre && !attendue) erreurs.push(m.text());
    });
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: require('path').join(__dirname, '..', 'fake-grist.js') });
    await page.addInitScript(([d, liee]) => {
        window.grist = window.createFakeGrist(d, liee ? { tableLiee: liee.table, selection: liee.id } : undefined);
    }, [doc || D.documentCible(), widget === 'fiche' ? { table: 'Projects', id: 2 } : null]);
    await page.goto('http://localhost:3001/tasks_app/' + widget + '.html');
    await page.setContent(CADRE.replace('__WIDGET__', widget));
    return erreurs;
}

const CAS = [
    { widget: 'gantt', attendu: '#taskList .task-row', contenu: 'Socle technique' },
    { widget: 'plan', attendu: '#gridwrap table.grid, #gridwrap .empty', contenu: 'Aujourd' },
    { widget: 'fiche', attendu: '.fiche-cadrage', contenu: 'Datalab' },
    { widget: 'kanban', attendu: '#kanbanContainer .kanban-column', contenu: null },
    { widget: 'calendar', attendu: '#gridContainer', contenu: null },
    { widget: 'dashboard', attendu: '.dash, #dashboard, .dashboard', contenu: null }
];

for (const cas of CAS) {
    test('le widget ' + cas.widget + ' rend dans un cadre', async ({ page }) => {
        const erreurs = await ouvrirDansUnCadre(page, cas.widget);

        await expect(page.frameLocator('#f').locator(cas.attendu).first()).toBeVisible({ timeout: 15000 });
        if (cas.contenu) await expect(page.frameLocator('#f').locator('body')).toContainText(cas.contenu);
        expect(erreurs).toEqual([]);
    });
}

// La fiche est le seul widget qui lit son enregistrement par onRecord : c'est là que la forme
// servie par le serveur l'a piégée, et le cadre est le contexte où cela se produit.
test('la fiche resout ses personnes dans un cadre', async ({ page }) => {
    await ouvrirDansUnCadre(page, 'fiche');

    const fiche = page.frameLocator('#f');
    await expect(fiche.locator('.bloc-responsable')).toContainText('Chloé Roux');
    await expect(fiche.locator('.bloc-sponsors')).toContainText('Alice Martin');
});
