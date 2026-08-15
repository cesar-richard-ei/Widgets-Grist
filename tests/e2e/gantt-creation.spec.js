'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Créer une ligne : le bouton unique et son menu, le type qui décide de la table cible, et la
// duplication d'une ligne existante.

const menu = (page) => page.locator('#menuAjout');
const typeChoisi = (page) => page.locator('#panel .type-pill.selected');

async function creer(page, quoi) {
    await page.locator('#btnAjouter').click();
    if (await menu(page).isVisible()) await menu(page).locator('button', { hasText: quoi }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

test('un seul bouton de création, qui propose les trois types', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#btnAjouter')).toHaveText(/Ajouter/);
    await expect(menu(page)).toBeHidden();

    await page.locator('#btnAjouter').click();

    await expect(menu(page).locator('button')).toHaveText(['Tâche', 'Chantier', 'Jalon']);
});

test('un clic à côté referme le menu', async ({ page }) => {
    await D.ouvrirGantt(page);
    await page.locator('#btnAjouter').click();
    await expect(menu(page)).toBeVisible();

    await page.locator('#taskList').click({ position: { x: 10, y: 300 } });

    await expect(menu(page)).toBeHidden();
});

for (const [choix, attendu] of [['Tâche', 'Tâche'], ['Chantier', 'Chantier'], ['Jalon', '◆ Jalon']]) {
    test('choisir ' + choix + ' ouvre la fiche correspondante', async ({ page }) => {
        await D.ouvrirGantt(page);

        await creer(page, choix);

        await expect(typeChoisi(page)).toHaveText(attendu);
        await expect(menu(page)).toBeHidden();
    });
}

test('sans table Chantiers, le bouton crée directement une tâche', async ({ page }) => {
    await D.ouvrirGantt(page, D.documentSansChantiers());

    await page.locator('#btnAjouter').click();

    await expect(menu(page)).toBeHidden();
    await expect(typeChoisi(page)).toHaveText('Tâche');
});

test('la fiche propose la tâche, le chantier puis le jalon', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');

    await expect(page.locator('#panel .type-pill')).toHaveText(['Tâche', 'Chantier', '◆ Jalon']);
    await expect(page.locator('#panel .type-pill', { hasText: 'Réunion' })).toHaveCount(0);
});

test('le type se change tant que la fiche est neuve, et se fige ensuite', async ({ page }) => {
    await D.ouvrirGantt(page);

    await creer(page, 'Tâche');
    await page.locator('#taskTitle').fill('Bascule en chantier');
    await page.locator('#panel .type-pill', { hasText: 'Chantier' }).click();

    await expect(typeChoisi(page)).toHaveText('Chantier');
    await expect(page.locator('#taskTitle')).toHaveValue('Bascule en chantier');

    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');
    await page.locator('#panel .type-pill', { hasText: 'Chantier' }).click();

    await expect(typeChoisi(page)).toHaveText('Tâche');
});

test('le parent se choisit à la création, parmi les tâches du même projet', async ({ page }) => {
    await D.ouvrirGantt(page, D.documentSansChantiers());

    await creer(page, 'Tâche');

    await expect(page.locator('#panelContent .prop-row', { hasText: 'Parent' })).toBeVisible();

    // Proposer une tâche d'un autre projet mènerait à une hiérarchie à cheval sur deux projets.
    const memeProjet = await page.evaluate(() => {
        const projet = panelState.editData.projet || null;
        const ids = Array.from(document.querySelectorAll('#parentSelect .multi-select-option'))
            .map((o) => Number((o.getAttribute('onclick').match(/setParent\((\d+)\)/) || [])[1]));
        return ids.length > 0 && ids.every((id) => {
            const t = tasks.find((x) => x.id === id);
            return t && (t.projet || null) === projet;
        });
    });
    expect(memeProjet).toBe(true);
    await page.locator('#parentSelect .addbtn').click();
    await page.locator('#parentSelect .multi-select-option').first().click();

    await expect(page.getByRole('button', { name: 'Détacher' })).toBeVisible();
});

test('dupliquer une tâche reprend ses champs et son rattachement', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await D.ouvrirVolet(page, 'Cadrage des outils');

    await page.locator('#panel button', { hasText: 'Dupliquer' }).click();

    await expect(page.locator('#taskTitle')).toHaveValue('Cadrage des outils (copie)');
    const copie = await page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        const i = t.titre.indexOf('Cadrage des outils (copie)');
        return { chantier: t.chantier[i], estimationH: t.estimationH[i], description: t.description[i] };
    });
    expect(copie).toEqual({ chantier: 1, estimationH: 8, description: 'Comparer les offres' });
});

test('un jalon se duplique en jalon', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.deplier(page, 'Socle technique', 'Plateforme prête');
    await D.ouvrirVolet(page, 'Plateforme prête');

    await page.locator('#panel button', { hasText: 'Dupliquer' }).click();

    await expect.poll(async () => page.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.type[t.titre.indexOf('Plateforme prête (copie)')];
    })).toBe('jalon');
});

test('un chantier ne se duplique pas', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    await expect(page.locator('#panel button', { hasText: 'Dupliquer' })).toHaveCount(0);
});

// Les listes de personnes et de tâches deviennent longues : chacune porte un champ de recherche,
// qui prend le focus à l'ouverture, filtre en direct, annonce l'absence de résultat et se rétablit.
async function verifierRecherche(page, selecteur) {
    const recherche = page.locator('#' + selecteur + ' .multi-select-search');
    await expect(recherche).toBeFocused();

    const options = page.locator('#' + selecteur + ' .multi-select-option');
    const total = await options.count();
    expect(total).toBeGreaterThan(0);
    const premier = (await options.first().innerText()).trim();

    await recherche.fill('zzintrouvablezz');
    await expect(page.locator('#' + selecteur + ' .multi-select-option:visible')).toHaveCount(0);
    await expect(page.locator('#' + selecteur + ' .multi-select-noresult')).toBeVisible();

    await recherche.fill(premier.slice(0, 3));
    const visibles = await page.locator('#' + selecteur + ' .multi-select-option:visible').count();
    expect(visibles).toBeGreaterThan(0);
    expect(visibles).toBeLessThanOrEqual(total);

    await recherche.fill('');
    await expect(page.locator('#' + selecteur + ' .multi-select-option:visible')).toHaveCount(total);
}

for (const [nom, selecteur, ouvrir] of [
    ['des contributeurs', 'assigneesSelect', '#assigneesSelect .addbtn'],
    ['des dépendances', 'depsSelect', '#depsSelect .multi-select-trigger']
]) {
    test('la liste ' + nom + ' se filtre à la saisie', async ({ page }) => {
        await D.ouvrirGantt(page);
        await D.deplier(page, 'Socle technique', 'Cadrage des outils');
        await D.ouvrirVolet(page, 'Cadrage des outils');

        await page.click(ouvrir);
        await verifierRecherche(page, selecteur);
    });
}

test('la liste des tâches parentes se filtre à la saisie', async ({ page }) => {
    await D.ouvrirGantt(page, D.documentSansChantiers());
    await D.ouvrirVolet(page, 'Recette');

    await page.click('#parentSelect .addbtn');
    await verifierRecherche(page, 'parentSelect');
});
