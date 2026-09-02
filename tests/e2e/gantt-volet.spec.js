'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Composition du volet de détail : quels blocs le composent, dans quel ordre, et lesquels
// disparaissent quand la donnée qui les alimente n'existe pas.

const ORDRE_ATTENDU = [
    'Description', 'Dates', 'Statut', 'Progression', 'Responsable', 'Contributeurs',
    'Projet', 'Chantier', 'Priorité', 'Sous-tâches (hiérarchie)', 'Parent', 'Dépendances', 'Tags', 'Temps & charge'
];

const section = (page, titre) => page.locator('#panel .panel-section', { has: page.locator('.panel-section-title', { hasText: titre }) });

// Libellés des blocs dans leur ordre **à l'écran** : le DOM ne suffit pas, une règle CSS peut le
// contredire, et un test qui lirait l'ordre du DOM passerait au vert sur un affichage faux.
const blocs = (page) => page.evaluate(() => Array.from(
    document.querySelectorAll('#panelContent .panel-section-title, #panelContent .props-list > .prop-row > .prop-label'))
    .map((el) => ({ texte: el.textContent.trim(), haut: el.getBoundingClientRect().top }))
    .sort((a, b) => a.haut - b.haut)
    .map((x) => x.texte));

async function ouvrirTache(page, doc) {
    await D.ouvrirGantt(page, doc);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');
}

test('les blocs suivent l ordre du cadrage', async ({ page }) => {
    await ouvrirTache(page);

    expect(await blocs(page)).toEqual(ORDRE_ATTENDU);
});

test('le titre coiffe tous les blocs', async ({ page }) => {
    await ouvrirTache(page);

    const dansLOrdre = await page.evaluate(() => {
        const titre = document.getElementById('taskTitle').getBoundingClientRect().top;
        const premier = document.querySelector('#panelContent .panel-section-title').getBoundingClientRect().top;
        return titre < premier;
    });
    expect(dansLOrdre).toBe(true);
});

test('le volet s en tient aux blocs du cadrage', async ({ page }) => {
    await ouvrirTache(page);

    for (const absent of ['Couleur', 'Checklist', 'Planning', 'Détails']) {
        await expect(page.locator('#panel .panel-section-title', { hasText: absent })).toHaveCount(0);
        await expect(page.locator('#panel .prop-label', { hasText: absent })).toHaveCount(0);
    }
    await expect(page.locator('#panel .panel-accent-bar')).toHaveCount(0);
    await expect(page.locator('#panel .panel-crumb')).toHaveCount(0);
    await expect(page.locator('#panel')).not.toContainText('Assignés');
});

test('la progression se règle à la jauge et aux paliers', async ({ page }) => {
    await ouvrirTache(page);

    await expect(page.locator('#panel .progress-bar-mini')).toHaveCount(1);
    await expect(page.locator('#panel .progress-preset')).toHaveCount(5);
    await expect(page.locator('#panel .progress-slider')).toHaveCount(0);
});

test('la description s ouvre sur deux lignes', async ({ page }) => {
    await ouvrirTache(page);

    const hauteur = await page.locator('#taskDescription').evaluate((el) => el.getBoundingClientRect().height);
    expect(hauteur).toBeGreaterThanOrEqual(50);
});

test('le bouton de suppression est nommé en entier', async ({ page }) => {
    await ouvrirTache(page);

    const bouton = page.locator('#panel .panel-footer-left .panel-btn.danger');
    await expect(bouton).toHaveText('Supprimer la tâche');
    expect(await bouton.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(120);
});

test('dépendances et tags ont chacun leur section', async ({ page }) => {
    await ouvrirTache(page);

    await expect(section(page, 'Dépendances').locator('#depsSelect')).toHaveCount(1);
    await expect(section(page, 'Tags').locator('#tagInput')).toHaveCount(1);
});

test('le volet d un chantier ne montre que ce qui le concerne', async ({ page }) => {
    await ouvrirTache(page);
    await D.ouvrirVolet(page, 'Socle technique');

    await expect(page.locator('#panel .type-pill.selected')).toHaveText('Chantier');
    await expect(section(page, 'Tâches')).toHaveCount(1);
    const vus = await blocs(page);
    expect(vus).toContain('Description');
    expect(vus).toContain('Dates');
    expect(vus).not.toContain('Priorité');
    expect(vus).not.toContain('Chantier');
    await expect(page.locator('#chantierSelect')).toHaveCount(0);
});

test('le rattachement au chantier se change depuis la fiche', async ({ page }) => {
    await ouvrirTache(page);

    await expect(page.locator('#chantierSelect')).toHaveValue('1');
    expect((await page.locator('#chantierSelect option').allTextContents()).join(' ')).toContain('Guides utilisateurs');

    await page.locator('#chantierSelect').selectOption('2');

    await expect.poll(() => D.champTache(page, 1, 'chantier')).toBe(2);
    await D.deplier(page, 'Guides utilisateurs', 'Cadrage des outils');
    await expect(D.ligne(page, 'Cadrage des outils')).toHaveAttribute('data-depth', '1');
});

test('le responsable se choisit, se remplace et se retire', async ({ page }) => {
    await ouvrirTache(page);

    await expect(page.locator('#responsableSelect').locator('..')).toContainText('Bruno Klein');

    await page.locator('#responsableSelect .addbtn').click();
    await page.locator('#responsableSelect .multi-select-option', { hasText: 'Alice Martin' }).click();
    await expect.poll(() => D.champTache(page, 1, 'Responsable')).toBe(1);
    // Nommer la personne, et pas seulement compter les pastilles : le volet gardait celle d'avant,
    // le compte restait à 1 et la fiche montrait l'ancien responsable jusqu'au rechargement.
    await expect(page.locator('#panel .resp-choisi')).toHaveCount(1);
    await expect(page.locator('#panel .resp-choisi')).toContainText('Alice Martin');
    await expect(D.ligne(page, 'Cadrage des outils').locator('.task-avatar').first()).toHaveAttribute('title', 'Alice Martin');

    await page.locator('#panel .resp-choisi .asg-x').click();
    await expect.poll(() => D.champTache(page, 1, 'Responsable')).toBeFalsy();
});

test('sans colonne Responsable, sa ligne disparaît du volet', async ({ page }) => {
    await ouvrirTache(page, D.sansColonne(D.documentCible(), 'Responsable'));

    await expect(page.locator('#panel .prop-label', { hasText: 'Responsable' })).toHaveCount(0);
});

// Le champ de recherche des sélecteurs comparait les libellés tels quels : « Chloé » ne sortait
// qu'en tapant l'accent, que le clavier de la personne le donne facilement ou non.
const optionsVisibles = (page, selecteur) => page.locator('#' + selecteur + ' .multi-select-option')
    .evaluateAll((options) => options.filter((o) => o.style.display !== 'none').map((o) => o.textContent.trim()));

test('la recherche dans une liste ignore les accents', async ({ page }) => {
    await ouvrirTache(page);
    await page.locator('#responsableSelect .addbtn').click();

    await page.locator('#responsableSelect .multi-select-search').fill('chloe');

    expect(await optionsVisibles(page, 'responsableSelect')).toEqual(['Chloé Roux']);
});

test('la recherche accentuée trouve toujours', async ({ page }) => {
    await ouvrirTache(page);
    await page.locator('#responsableSelect .addbtn').click();

    await page.locator('#responsableSelect .multi-select-search').fill('chloé');

    expect(await optionsVisibles(page, 'responsableSelect')).toEqual(['Chloé Roux']);
});
