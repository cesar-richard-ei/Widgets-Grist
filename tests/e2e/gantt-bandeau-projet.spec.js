'use strict';

const path = require('path');
const base = require('@playwright/test');
const test = base.test;
const expect = base.expect;

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

const jour = 86400;
const aujourdhui = Math.floor(Date.now() / 1000 / jour) * jour;
const j = (n) => aujourdhui + n * jour;

const VERT = { hex: '#10b981', rgb: 'rgb(16, 185, 129)' };
const ORANGE = { hex: '#f59e0b', rgb: 'rgb(245, 158, 11)' };

const DOC = {
    Projects: {
        columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, actif: { type: 'Bool' }, responsable: { type: 'Ref:Team' } },
        records: [
            { id: 1, nom: 'Portail', couleur: '#3e5de7', actif: true, responsable: 2 },
            { id: 2, nom: 'Datalab', couleur: ORANGE.hex, actif: true }
        ]
    },
    Team: {
        columns: { nom: { type: 'Text' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } },
        records: [{ id: 1, nom: 'Alice Martin', actif: true, couleur: '#3e5de7' }, { id: 2, nom: 'Bruno Klein', actif: true, couleur: VERT.hex }]
    },
    Tasks: {
        columns: {
            parentTask: { type: 'Ref:Tasks' }, titre: { type: 'Text' }, description: { type: 'Text' },
            dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, priorite: { type: 'Choice' },
            statut: { type: 'Choice' }, progression: { type: 'Numeric' }, assignees: { type: 'RefList:Team' },
            type: { type: 'Choice' }, dependDe: { type: 'RefList:Tasks' }, tags: { type: 'ChoiceList' },
            estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' }, couleur: { type: 'Text' },
            subtasks: { type: 'Text' }, projet: { type: 'Ref:Projects' }, charges: { type: 'Text' },
            dateCloture: { type: 'Date' }, Responsable: { type: 'Ref:Team' }
        },
        records: [
            { id: 1, titre: 'Cadrage portail', projet: 1, dateDebut: j(-4), dateEcheance: j(6), statut: 'todo', type: 'tache', priorite: '2' },
            { id: 2, titre: 'Socle datalab', projet: 2, dateDebut: j(-2), dateEcheance: j(8), statut: 'todo', type: 'tache', priorite: '2' }
        ]
    }
};

async function ouvrirGantt(page) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => { window.grist = window.createFakeGrist(d); try { localStorage.clear(); } catch (e) {} }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .groupe-projet');
}

const fondDuBandeau = (page, nom) => page.locator('#taskList .groupe-projet', { hasText: nom }).evaluate((el) => getComputedStyle(el).backgroundColor);

test('le bandeau prend la couleur du responsable du projet', async ({ page }) => {
    await ouvrirGantt(page);

    const fond = await fondDuBandeau(page, 'Portail');
    expect(fond).toContain(VERT.rgb.replace('rgb(', '').replace(')', ''));
});

test('sans responsable, le bandeau retombe sur la couleur du projet', async ({ page }) => {
    await ouvrirGantt(page);

    const fond = await fondDuBandeau(page, 'Datalab');
    expect(fond).toContain(ORANGE.rgb.replace('rgb(', '').replace(')', ''));
});

test('un responsable sans couleur laisse la main a celle du projet', async ({ page }) => {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript((d) => {
        d.Team.records[1].couleur = '';
        window.grist = window.createFakeGrist(d);
        try { localStorage.clear(); } catch (e) {}
    }, DOC);
    await page.goto('http://localhost:3001/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .groupe-projet');

    const fond = await fondDuBandeau(page, 'Portail');
    expect(fond).toContain('62, 93, 231');
});

test('le bandeau est translucide, pas plein', async ({ page }) => {
    await ouvrirGantt(page);

    const fond = await fondDuBandeau(page, 'Portail');
    const alpha = parseFloat(/rgba\([^)]*,\s*([\d.]+)\)/.exec(fond)[1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(0.4);
});

test('le bandeau se prolonge sur la timeline', async ({ page }) => {
    await ouvrirGantt(page);

    const pistes = page.locator('#timelineGrid .grid-row.piste-groupe');
    await expect(pistes).toHaveCount(2);
    const fond = await pistes.first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fond).toContain(VERT.rgb.replace('rgb(', '').replace(')', ''));
});

test('aucun trait ne separe le bandeau de sa premiere ligne', async ({ page }) => {
    await ouvrirGantt(page);

    await expect(page.locator('#taskList .debut-groupe')).toHaveCount(0);
    await expect(page.locator('#timelineGrid .debut-groupe')).toHaveCount(0);
});
