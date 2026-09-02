'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Le domaine d'une personne, c'est son équipe : la colonne `Team.role`. Une ligne est retenue dès
// qu'une personne du domaine la touche, directement ou par son chantier ou son projet. Un directeur
// de domaine veut voir tout ce qui occupe son équipe, pas seulement ce qu'elle pilote.

const filtrer = (page, domaine) => page.evaluate((d) => toggleFilter('domaine', d), domaine);

function responsableDeChantier(doc, idChantier, idMembre) {
    const copie = JSON.parse(JSON.stringify(doc));
    copie.Chantiers.records.find((c) => c.id === idChantier).Responsable = idMembre;
    return copie;
}

test('une ligne est retenue quand une de ses personnes porte le domaine', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);
    await filtrer(page, 'Données');

    // David est contributeur de « Cadrage des outils » et responsable du jalon.
    await expect(D.ligne(page, 'Cadrage des outils')).toBeVisible();
    await expect(D.ligne(page, 'Plateforme prête')).toBeVisible();
    await expect(D.ligne(page, 'Guide de prise en main')).toHaveCount(0);
});

test('une ligne sans personne est retenue par le responsable de son chantier', async ({ page }) => {
    await D.ouvrirGantt(page, responsableDeChantier(D.documentCible(), 1, 4));
    await D.toutDeplier(page);
    await filtrer(page, 'Données');

    // « Recette » ne porte ni responsable ni contributeur : seul son chantier la rattache au domaine.
    await expect(D.ligne(page, 'Recette')).toBeVisible();
});

test('une ligne sans chantier est retenue par le responsable de son projet', async ({ page }) => {
    await D.ouvrirGantt(page, D.documentSansChantiers());
    await D.toutDeplier(page);
    await filtrer(page, 'Expérience');

    // Chloé pilote « Datalab », qui porte « Guide de prise en main ».
    await expect(D.ligne(page, 'Guide de prise en main')).toBeVisible();
});

// Le métier pose ses propres colonnes de personnes sur un projet, un sponsor par exemple. Elles se
// reconnaissent à leur type, la liste n'en est pas figée dans le widget.
test('une colonne de personnes ajoutee sur un projet compte aussi', async ({ page }) => {
    const doc = D.documentSansChantiers();
    doc.Projects.columns.Sponsor = { type: 'RefList:Team' };
    doc.Projects.records.find((p) => p.id === 1).Sponsor = ['L', 4];
    await D.ouvrirGantt(page, doc);
    await D.toutDeplier(page);
    await filtrer(page, 'Données');

    // « Recette » ne tient au domaine que par le sponsor de son projet.
    await expect(D.ligne(page, 'Recette')).toBeVisible();
});

test('le filtre par domaine s efface avec les autres', async ({ page }) => {
    await D.ouvrirGantt(page);
    await filtrer(page, 'Données');
    await expect(D.ligne(page, 'Guide de prise en main')).toHaveCount(0);

    await page.evaluate(() => clearAllGanttFilters());
    await D.toutDeplier(page);

    await expect(D.ligne(page, 'Guide de prise en main')).toBeVisible();
});

test('sans domaine renseigne sur les effectifs, le groupe de filtre disparait', async ({ page }) => {
    const doc = D.documentCible();
    doc.Team.records.forEach((m) => { m.Domaine = null; });
    await D.ouvrirGantt(page, doc);
    await page.locator('#filterGantt .filter-btn').click();

    await expect(page.locator('#filterAllMenu')).not.toContainText('Domaines');
});

// Les domaines fermaient le menu, sous les priorités et les assignés, alors qu'ils servent plus
// souvent. Et leurs options n'avaient pas la pastille que portent projets et priorités.
const ouvrirMenuFiltres = async (page) => {
    await page.locator('#filterGantt .filter-btn').click();
    await page.waitForSelector('#filterAllMenu.open');
};

test('les domaines sont proposes avant les priorites', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrirMenuFiltres(page);

    const groupes = await page.locator('#filterAllMenu .fm-group-label').allTextContents();
    expect(groupes).toEqual(['Projets', 'Domaines', 'Priorités', 'Assignés']);
});

test('chaque domaine porte la couleur de son equipe', async ({ page }) => {
    await D.ouvrirGantt(page);
    await ouvrirMenuFiltres(page);

    const pastilles = await page.locator('#filterAllMenu .filter-option[data-filtre="domaine"]')
        .evaluateAll((options) => options.map((o) => {
            const dot = o.querySelector('.dot');
            return [o.textContent.trim(), dot && dot.style.background];
        }));

    // Bruno Klein porte « Socle technique » et la couleur verte des effectifs.
    expect(pastilles).toContainEqual(['Socle technique', 'rgb(16, 185, 129)']);
    expect(pastilles.every(([, couleur]) => !!couleur)).toBe(true);
});
