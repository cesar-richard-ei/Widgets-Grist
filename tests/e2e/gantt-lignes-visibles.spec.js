'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Seules les lignes proches de l'écran sont construites, des cales tenant la hauteur du reste :
// tout déplié, le document du métier comptait 24 600 éléments reconstruits à chaque rendu.

const NB_TACHES = 400;

function documentLong() {
    const doc = D.documentCible();
    const debut = doc.Tasks.records[0].dateDebut;
    for (let i = 0; i < NB_TACHES; i++) {
        doc.Tasks.records.push({ id: 100 + i, titre: 'Tâche numéro ' + i, chantier: 1, dateDebut: debut, dateEcheance: debut + 86400 * 5, statut: 'todo', type: 'tache', priorite: '3' });
    }
    return doc;
}

async function ouvrirLong(page) {
    await D.ouvrirGantt(page, documentLong(), { largeur: 1400, hauteur: 800 });
    await D.toutDeplier(page);
}

const defiler = (page, y) => page.evaluate(async (v) => {
    const sc = document.getElementById('timelineScroll');
    sc.scrollTop = v === 'fin' ? sc.scrollHeight : v;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, y);

test('seules les lignes proches de l ecran sont construites', async ({ page }) => {
    await ouvrirLong(page);

    expect(await page.locator('#taskList .task-row').count()).toBeLessThan(80);
    expect(await page.locator('#timelineGrid .gantt-bar').count()).toBeLessThan(80);
});

test('la hauteur totale ne change pas', async ({ page }) => {
    await ouvrirLong(page);

    const hauteurs = await page.evaluate(() => ({
        liste: document.getElementById('taskList').scrollHeight,
        grille: document.getElementById('timelineGrid').getBoundingClientRect().height,
        attendue: geometrieDesLignes().total
    }));
    expect(Math.abs(hauteurs.grille - hauteurs.attendue)).toBeLessThan(1);
    expect(Math.abs(hauteurs.liste - hauteurs.attendue)).toBeLessThan(2);
});

test('defiler jusqu en bas construit les dernieres lignes', async ({ page }) => {
    await ouvrirLong(page);
    await defiler(page, 'fin');

    await expect(D.ligne(page, 'Tâche numéro ' + (NB_TACHES - 1))).toBeVisible();
    await expect(D.ligne(page, 'Tâche numéro 0')).toHaveCount(0);
});

test('apres defilement, chaque ligne reste en face de sa piste et sa barre dans sa ligne', async ({ page }) => {
    await ouvrirLong(page);
    await defiler(page, 6000);

    const mesure = await page.evaluate(() => Array.from(document.querySelectorAll('#taskList .task-row')).map((l) => {
        const barre = document.querySelector('#timelineGrid .gantt-bar[data-id="' + l.dataset.id + '"]');
        if (!barre) return true;
        const a = l.getBoundingClientRect(), b = barre.getBoundingClientRect();
        return b.top >= a.top && b.bottom <= a.bottom;
    }));
    expect(mesure.length).toBeGreaterThan(5);
    expect(mesure.every(Boolean)).toBe(true);
});

test('le bandeau du projet reste colle en haut une fois descendu loin', async ({ page }) => {
    await ouvrirLong(page);
    await defiler(page, 9000);

    const ecart = await page.evaluate(() => {
        const bandeau = document.querySelector('#taskList .groupe-projet');
        return bandeau ? Math.abs(bandeau.getBoundingClientRect().top - document.getElementById('taskList').getBoundingClientRect().top) : null;
    });
    expect(ecart).not.toBeNull();
    expect(ecart).toBeLessThan(2);
});

test('une dependance vers une ligne hors fenetre reste tracee', async ({ page }) => {
    const doc = documentLong();
    doc.Tasks.records.find((t) => t.id === 100 + NB_TACHES - 1).dependDe = ['L', 1];
    await D.ouvrirGantt(page, doc, { largeur: 1400, hauteur: 800 });
    await D.toutDeplier(page);

    await expect(page.locator('.dependencies-layer .dependency-line[data-vers="' + (100 + NB_TACHES - 1) + '"]')).toHaveCount(1);
});
