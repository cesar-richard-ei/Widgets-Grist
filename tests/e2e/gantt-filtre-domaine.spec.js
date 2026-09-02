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

// Le métier pose ses propres colonnes de personnes, un sponsor par exemple. Elles se reconnaissent
// à leur type, la liste n'en est pas figée dans le widget.
test('une colonne de personnes ajoutee sur un chantier compte aussi', async ({ page }) => {
    const doc = D.documentCible();
    doc.Chantiers.columns.Sponsor = { type: 'RefList:Team' };
    doc.Chantiers.records.find((c) => c.id === 1).Sponsor = ['L', 4];
    await D.ouvrirGantt(page, doc);
    await D.toutDeplier(page);
    await filtrer(page, 'Données');

    // « Cadrage des outils » ne tient au domaine que par le sponsor de son chantier.
    await expect(D.ligne(page, 'Cadrage des outils')).toBeVisible();
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

// Le document appartient au métier : ce qu'on y saisit part dans des attributs du menu. Sans
// échappement des guillemets, un domaine peut en sortir et poser son propre gestionnaire.
test('un domaine ne peut pas sortir de son attribut', async ({ page }) => {
    const doc = D.documentCible();
    doc.Team.records[0].Domaine = 'Pilotage" onmouseover="window.__injecte=1';
    doc.Team.records[0].couleur = 'red;" onmouseover="window.__injecte=1';
    await D.ouvrirGantt(page, doc);
    await page.locator('#filterGantt .filter-btn').click();
    await page.waitForSelector('#filterAllMenu.open');

    const option = page.locator('#filterAllMenu .filter-option[data-filtre="domaine"]', { hasText: 'Pilotage' });
    await expect(option).toHaveCount(1);
    expect(await option.getAttribute('onmouseover')).toBeNull();
    expect(await option.locator('.dot').getAttribute('onmouseover')).toBeNull();
    // La couleur refusée retombe sur celle de repli, elle ne part pas telle quelle.
    expect(await option.locator('.dot').evaluate((n) => n.style.background)).toBe('rgb(99, 102, 241)');
    // Le libellé garde le texte saisi, sans qu'il ait été interprété.
    await expect(option).toContainText('onmouseover');
    expect(await page.evaluate(() => window.__injecte)).toBeUndefined();
});

// Le domaine d'une personne posée sur le projet faisait entrer tout ce qui s'y rattache, chantiers
// et tâches sans lien direct compris. Une ligne n'est plus retenue que par ses propres personnes et
// celles de son chantier.
test('une personne du domaine sur le seul projet ne fait plus entrer ses lignes', async ({ page }) => {
    const doc = D.documentCible();
    // Personne du domaine « Données » sur les tâches ni sur les chantiers ; David pilote le projet.
    doc.Projects.records.find((p) => p.id === 1).responsable = 4;
    doc.Chantiers.records.forEach((c) => { delete c.Responsable; delete c.Contributeurs; });
    doc.Tasks.records.forEach((t) => { delete t.Responsable; t.assignees = ['L']; });
    await D.ouvrirGantt(page, doc);

    await page.evaluate(() => toggleFilter('domaine', 'Données'));

    await expect(page.locator('#taskList .task-row')).toHaveCount(0);
});
