'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Un tag rassemble les chantiers et les tâches d'un même programme. Le tag d'un chantier vaut pour
// toutes ses tâches ; une tâche marquée seule ramène son chantier, pour le contexte.

const filtrer = (page, tag) => page.evaluate((t) => toggleFilter('tag', t), tag);

function documentTague() {
    const doc = D.documentCible();
    doc.Chantiers.columns.tags = { type: 'ChoiceList' };
    doc.Chantiers.records.find((c) => c.id === 2).tags = ['L', 'ACCES'];
    return doc;
}

test('le menu Tag liste les tags des chantiers et des taches', async ({ page }) => {
    await D.ouvrirGantt(page, documentTague());
    await page.locator('#filtreTag .filter-btn').click();

    await expect(page.locator('#menuTag .filter-option[data-filtre]')).toHaveText(['ACCES', 'poc']);
});

test('le tag d un chantier retient le chantier et toutes ses taches', async ({ page }) => {
    await D.ouvrirGantt(page, documentTague());
    await D.toutDeplier(page);
    await filtrer(page, 'ACCES');

    await expect(D.ligne(page, 'Guides utilisateurs')).not.toHaveClass(/dimmed/);
    await expect(D.ligne(page, 'Guide de prise en main')).not.toHaveClass(/dimmed/);
    await expect(D.ligne(page, 'Socle technique')).toHaveCount(0);
    await expect(D.ligne(page, 'Cadrage des outils')).toHaveCount(0);
});

test('une tache taguee seule ramene son chantier en contexte', async ({ page }) => {
    await D.ouvrirGantt(page, documentTague());
    await D.toutDeplier(page);
    await filtrer(page, 'poc');

    await expect(D.ligne(page, 'Cadrage des outils')).not.toHaveClass(/dimmed/);
    await expect(D.ligne(page, 'Socle technique')).toHaveClass(/dimmed/);
    await expect(D.ligne(page, 'Recette')).toHaveCount(0);
    await expect(D.ligne(page, 'Guides utilisateurs')).toHaveCount(0);
});

test('le filtre par tag a sa pastille et s efface avec les autres', async ({ page }) => {
    await D.ouvrirGantt(page, documentTague());
    await filtrer(page, 'ACCES');
    await expect(page.locator('#filterChips .fc-chip')).toHaveText(['ACCES']);

    await page.evaluate(() => clearAllGanttFilters());
    await D.toutDeplier(page);
    await expect(D.ligne(page, 'Cadrage des outils')).toBeVisible();
});

test('sans aucun tag, le filtre Tag disparait de la barre', async ({ page }) => {
    const doc = D.documentCible();
    doc.Tasks.records.forEach((t) => { delete t.tags; });
    await D.ouvrirGantt(page, doc);

    await expect(page.locator('#filtreTag')).toBeHidden();
});

// Les lignes retenues sont souvent des tâches, rangées sous un chantier replié : le filtre déplie
// le chemin qui y mène, sans quoi on ne verrait que le chantier.
test('poser un filtre deplie les branches qui menent aux lignes retenues', async ({ page }) => {
    await D.ouvrirGantt(page, documentTague());
    await expect(D.ligne(page, 'Cadrage des outils')).toHaveCount(0);

    await filtrer(page, 'poc');

    await expect(D.ligne(page, 'Cadrage des outils')).toBeVisible();
});

test('une branche depliee par le filtre se replie encore a la main', async ({ page }) => {
    await D.ouvrirGantt(page, documentTague());
    await filtrer(page, 'poc');
    await expect(D.ligne(page, 'Cadrage des outils')).toBeVisible();

    await D.ligne(page, 'Socle technique').locator('.tree-chevron').click();

    await expect(D.ligne(page, 'Cadrage des outils')).toHaveCount(0);
});

// Le volet montre ce que le filtre retient : les tags reçus du chantier et des tâches parentes
// s'affichent à côté des siens, sans pouvoir s'y retirer ni partir en base.
function sousTacheSousChantierTague() {
    const doc = documentTague();
    doc.Chantiers.records.find((c) => c.id === 1).tags = ['L', 'ACCES'];
    return doc;
}

test('le volet d une sous-tache montre les tags herites et leur origine', async ({ page }) => {
    await D.ouvrirGantt(page, sousTacheSousChantierTague());
    await D.toutDeplier(page);
    await D.ouvrirVolet(page, 'Atelier de cadrage');

    const herites = page.locator('#panel .tag-chip.herite');
    await expect(herites).toHaveText(['#poc', '#ACCES']);
    await expect(herites.first()).toHaveAttribute('title', 'Hérité de Cadrage des outils');
    await expect(herites.nth(1)).toHaveAttribute('title', 'Hérité de Socle technique');
    await expect(herites.locator('.remove')).toHaveCount(0);
});

test('un tag herite ne part pas en base avec les tags de la tache', async ({ page }) => {
    await D.ouvrirGantt(page, sousTacheSousChantierTague());
    await D.toutDeplier(page);
    await D.ouvrirVolet(page, 'Atelier de cadrage');

    await page.locator('#tagInput').fill('atelier');
    await page.locator('#tagInput').press('Enter');

    await expect.poll(() => D.champTache(page, 6, 'tags')).toEqual(['L', 'atelier']);
});

test('un tag pose sur la tache n est pas repete comme herite', async ({ page }) => {
    const doc = sousTacheSousChantierTague();
    doc.Tasks.records.find((t) => t.id === 1).tags = ['L', 'poc', 'ACCES'];
    await D.ouvrirGantt(page, doc);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');

    await expect(page.locator('#panel .tag-chip.herite')).toHaveCount(0);
});
