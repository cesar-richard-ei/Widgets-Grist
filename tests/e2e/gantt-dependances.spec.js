'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Deux types de lien coexistent : fin→début, qui fait commencer une tâche après la fin d'une autre,
// et début→début, qui les fait démarrer ensemble. Chacun vit dans sa propre colonne, et celle du
// début→début appartient à la structure du document : elle peut manquer.

const documentAvecLiens = () => D.avecLiens(D.documentCible(), {
    'Recette': { fin: ['Cadrage des outils'] },
    'Guide de prise en main': { debut: ['Analyse Plateforme Applicative et Cartographie des Usages'] }
});

const traits = (page, classe) => page.locator('.dependencies-layer .dependency-line' + (classe || '')).count();

// Les tâches vivent sous leur chantier : sans dépliage, ni leur ligne ni leur barre n'existent.
async function ouvrirTache(page, titre) {
    await D.toutDeplier(page);
    await D.ouvrirVolet(page, titre);
}

/** Barre de la ligne portant ce titre, repérée par son rang dans la liste de gauche. */
async function barreDe(page, titre) {
    const rang = await page.evaluate((t) => Array.from(document.querySelectorAll('#taskList .task-row'))
        .findIndex((r) => r.textContent.includes(t)), titre);
    return page.locator('#timelineGrid .gantt-bar').nth(rang);
}

test('les deux types de lien sont tracés, chacun avec son trait', async ({ page }) => {
    await D.ouvrirGantt(page, documentAvecLiens());
    await D.toutDeplier(page);

    expect(await traits(page)).toBe(2);
    expect(await traits(page, '.depart-debut')).toBe(1);
});

test('un lien début→début part du début du prédécesseur, pas de sa fin', async ({ page }) => {
    await D.ouvrirGantt(page, documentAvecLiens());
    await D.toutDeplier(page);

    // Le prédécesseur court sur trente jours : une origine prise sur sa fin serait très à droite de
    // son début. Comparer les deux traits suffit, sans dépendre de l'échelle de la vue.
    const origines = await page.evaluate(() => Array.from(document.querySelectorAll('.dependencies-layer .dependency-line'))
        .map((p) => ({ debut: p.classList.contains('depart-debut'), x: Number(p.getAttribute('d').match(/^M(-?[\d.]+),/)[1]) })));
    const fin = origines.find((o) => !o.debut);
    const debut = origines.find((o) => o.debut);

    const barre = await page.evaluate(() => {
        const ligne = Array.from(document.querySelectorAll('#taskList .task-row'))
            .find((r) => r.textContent.includes('Analyse Plateforme'));
        const i = Array.from(document.querySelectorAll('#taskList .task-row')).indexOf(ligne);
        const b = document.querySelectorAll('#timelineGrid .gantt-bar')[i];
        return b ? b.offsetLeft : null;
    });

    expect(debut.x).toBeLessThan(fin.x);
    if (barre !== null) expect(Math.abs(debut.x - barre)).toBeLessThan(2);
});

test('sans la colonne, les liens début→début disparaissent du volet et du tracé', async ({ page }) => {
    await D.ouvrirGantt(page, D.sansColonne(documentAvecLiens(), 'dependDebutDe'));
    await D.toutDeplier(page);

    expect(await traits(page)).toBe(1);
    expect(await traits(page, '.depart-debut')).toBe(0);

    await D.ouvrirVolet(page, 'Recette');
    await expect(page.locator('#depsSelect')).toHaveCount(1);
    await expect(page.locator('#depsDebutSelect')).toHaveCount(0);
    await expect(page.locator('#panel .deps-group-label', { hasText: 'Démarre avec' })).toHaveCount(0);
});

test('le volet propose les deux listes, et écrit dans la bonne colonne', async ({ page }) => {
    await D.ouvrirGantt(page, documentAvecLiens());
    await ouvrirTache(page, 'Recette');

    await expect(page.locator('#depsDebutSelect')).toHaveCount(1);

    await page.locator('#depsDebutSelect .multi-select-trigger').click();
    await page.locator('#depsDebutSelect .multi-select-option', { hasText: 'Cadrage des outils' }).click();

    await expect.poll(() => D.champTache(page, 3, 'dependDebutDe')).toEqual(['L', 1]);
    // La liste fin→début ne bouge pas : les deux colonnes sont indépendantes.
    expect(await D.champTache(page, 3, 'dependDe')).toEqual(['L', 1]);
});

// « Cadrage des outils » (id 1) commence quinze jours avant aujourd'hui, « Recette » (id 3) cinq
// jours après : repousser le prédécesseur au-delà du successeur doit tirer celui-ci avec lui.
test('déplacer un prédécesseur début→début tire le successeur sur son nouveau début', async ({ page }) => {
    await D.ouvrirGantt(page, D.avecLiens(D.documentCible(), {
        'Recette': { debut: ['Cadrage des outils'] }
    }));
    await D.toutDeplier(page);

    const boite = await (await barreDe(page, 'Cadrage des outils')).boundingBox();
    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await page.mouse.down();
    await page.mouse.move(boite.x + boite.width / 2 + 400, boite.y + boite.height / 2, { steps: 12 });
    await page.mouse.up();
    await D.attendreRendu(page);

    await expect.poll(() => D.champTache(page, 3, 'dateDebut')).toBe(await D.champTache(page, 1, 'dateDebut'));
});

test('un lien début→début compte dans les cycles interdits', async ({ page }) => {
    await D.ouvrirGantt(page, D.avecLiens(D.documentCible(), {
        'Recette': { debut: ['Cadrage des outils'] }
    }));
    await ouvrirTache(page, 'Cadrage des outils');

    await page.locator('#depsSelect .multi-select-trigger').click();
    await expect(page.locator('#depsSelect .multi-select-option', { hasText: 'Recette' })).toHaveCount(0);
});
