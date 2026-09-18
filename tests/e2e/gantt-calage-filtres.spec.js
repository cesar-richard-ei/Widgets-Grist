'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Changer de filtre change la plage de la timeline : une tâche ancienne qui entre dans la sélection
// recule sa borne gauche de plusieurs années. Le défilement se mesure en pixels : inchangé, il
// désigne alors une date lointaine, et l'utilisateur se retrouve en 2020 sans avoir navigué.

function documentAvecTacheAncienne() {
    const doc = D.documentCible();
    doc.Chantiers.records.push({ id: 3, Nom_du_chantier: 'Archives', Projets: ['L', 1], Responsable: 4 });
    doc.Tasks.records.push({
        id: 20, titre: 'Vieux sujet', chantier: 3, Responsable: 4,
        dateDebut: D.j(-6 * 365), dateEcheance: D.j(-6 * 365 + 30), statut: 'todo', type: 'tache', priorite: '3'
    });
    return doc;
}

const dateAuBordGauche = (page) => page.evaluate(() => {
    const sc = document.getElementById('timelineScroll');
    const jours = sc.scrollLeft / effectivePxPerDay;
    const d = new Date(effectiveStart.getTime());
    d.setDate(d.getDate() + Math.round(jours));
    return d.getFullYear();
});

test('passer du filtre projet au filtre domaine garde la periode affichee', async ({ page }) => {
    await D.ouvrirGantt(page, documentAvecTacheAncienne());
    await page.evaluate(() => toggleFilter('project', 2));
    await D.attendreRendu(page);

    const avant = await dateAuBordGauche(page);
    expect(avant).toBe(new Date().getFullYear());

    await page.evaluate(() => { clearAllGanttFilters(); toggleFilter('domaine', 'Données'); });
    await D.attendreRendu(page);

    expect(await dateAuBordGauche(page)).toBe(avant);
});

test('poser un filtre qui fait entrer une tache ancienne ne remonte pas dans le passe', async ({ page }) => {
    await D.ouvrirGantt(page, documentAvecTacheAncienne());
    const avant = await dateAuBordGauche(page);

    await page.evaluate(() => toggleFilter('domaine', 'Données'));
    await D.attendreRendu(page);

    expect(await dateAuBordGauche(page)).toBe(avant);
});
