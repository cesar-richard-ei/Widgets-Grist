'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// La colonne de gauche : ce qu'elle montre de chaque ligne, sa largeur, et le repli des branches.

const largeurColonne = (page) => page.locator('#taskList').evaluate((el) => el.getBoundingClientRect().width);
const largeurVolet = (page) => page.locator('#panel').evaluate((el) => el.getBoundingClientRect().width);
const pastilles = (page, titre) => D.ligne(page, titre).locator('.task-avatar').allTextContents();

// Le survol amène la souris sur la poignée après s'être assuré qu'elle est immobile et qu'elle
// reçoit bien les événements. Viser une boîte relevée d'avance laisse le clic tomber à côté dès
// que quelque chose bouge encore, sans que rien ne le signale.
async function tirerPoignee(page, id, dx) {
    const poignee = page.locator('#' + id);
    await poignee.hover();
    const boite = await poignee.boundingBox();
    await page.mouse.down();
    await page.mouse.move(boite.x + boite.width / 2 + dx, boite.y + boite.height / 2, { steps: 10 });
    await page.mouse.up();
    await D.attendreRendu(page);
}

test('la colonne s ouvre à 310 px', async ({ page }) => {
    await D.ouvrirGantt(page);

    expect(Math.round(await largeurColonne(page))).toBe(310);
});

test('la colonne se redimensionne à la souris et la largeur est retrouvée', async ({ page }) => {
    await D.ouvrirGantt(page);
    const avant = await largeurColonne(page);

    await tirerPoignee(page, 'poigneeTaskList', 120);

    const apres = await largeurColonne(page);
    expect(apres).toBeGreaterThan(avant + 80);

    await D.ouvrirGantt(page, null, { reglages: { taskflow_gantt_largeur_liste: String(Math.round(apres)) } });
    expect(Math.abs(await largeurColonne(page) - apres)).toBeLessThan(2);
});

test('la colonne ne peut ni disparaître ni manger la timeline', async ({ page }) => {
    await D.ouvrirGantt(page);

    await tirerPoignee(page, 'poigneeTaskList', -600);
    expect(await largeurColonne(page)).toBeGreaterThan(100);

    await tirerPoignee(page, 'poigneeTaskList', 2000);
    const vue = await page.evaluate(() => document.documentElement.clientWidth);
    expect(await largeurColonne(page)).toBeLessThan(vue * 0.75);
});

test('les poignées annoncent un redimensionnement horizontal', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    for (const id of ['poigneeTaskList', 'poigneePanel']) {
        expect(await page.locator('#' + id).evaluate((el) => getComputedStyle(el).cursor)).toBe('ew-resize');
    }
});

test('le volet s ouvre sur la moitié de la place et s étire à la souris', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.ouvrirVolet(page, 'Socle technique');

    const dispo = await page.evaluate(() => document.documentElement.clientWidth - document.getElementById('taskList').getBoundingClientRect().width);
    const avant = await largeurVolet(page);
    expect(Math.abs(avant - dispo / 2)).toBeLessThan(dispo * 0.15);

    await tirerPoignee(page, 'poigneePanel', -250);
    expect(await largeurVolet(page)).toBeGreaterThan(avant + 100);
});

test('une ligne montre le responsable, un contributeur, puis un compteur', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    // Responsable Bruno, contributeurs Alice, Bruno, Chloé, David : Bruno en tête, Alice ensuite.
    expect(await pastilles(page, 'Cadrage des outils')).toEqual(['BK', 'AM', '+2']);
});

test('sans responsable, les deux premiers contributeurs prennent la place', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    expect(await pastilles(page, 'Analyse Plateforme')).toEqual(['AM', 'CR']);
});

test('un responsable hors des contributeurs les compte quand même', async ({ page }) => {
    const doc = D.documentCible();
    doc.Tasks.records[0].Responsable = 4;
    await D.ouvrirGantt(page, doc);
    await D.toutDeplier(page);

    expect(await pastilles(page, 'Cadrage des outils')).toEqual(['DS', 'AM', '+2']);
});

test('une ligne sans personne n affiche aucune pastille', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    expect(await pastilles(page, 'Recette')).toEqual([]);
});

test('la ligne s en tient à ce qui la concerne', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    // L'avancement et le compte de sous-tâches restent au chantier, la tâche garde ses dates.
    await expect(D.ligne(page, 'Socle technique').locator('.task-progress-badge')).toHaveCount(1);
    await expect(D.ligne(page, 'Socle technique').locator('.task-subtask-badge')).toHaveCount(1);
    await expect(D.ligne(page, 'Cadrage des outils').locator('.task-progress-badge')).toHaveCount(0);
    await expect(D.ligne(page, 'Cadrage des outils').locator('.task-dates')).toHaveCount(1);

    await expect(page.locator('#taskList .task-priority-bar')).toHaveCount(0);
    await expect(page.locator('#ganttLegend')).toHaveCount(0);
});

test('la poignée de glisser ne paraît qu en tri manuel', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#taskList .drag-handle')).toHaveCount(0);

    await D.trier(page, 'manual');

    await expect(page.locator('#taskList .drag-handle').first()).toBeVisible();
});

test('le compteur ne retient que les tâches affichées', async ({ page }) => {
    await D.ouvrirGantt(page);
    const compteur = () => page.locator('#taskCount').textContent();

    // Chantiers repliés : aucune tâche visible, et ni les bandeaux ni les chantiers ne comptent.
    expect(await compteur()).toBe('0');

    await D.toutDeplier(page);

    expect(Number(await compteur())).toBe(await page.locator('#taskList .task-row[data-depth="1"], #taskList .task-row[data-depth="2"]').count());
});

test('le bouton replier-tout paraît avec la première branche dépliée et referme tout', async ({ page }) => {
    await D.ouvrirGantt(page);
    const bouton = page.locator('#collapseAllBtn');

    await expect(bouton).toBeHidden();

    await D.deplier(page, 'Socle technique', 'Cadrage des outils');
    await expect(bouton).toBeVisible();
    const avant = await page.locator('#taskList .task-row').count();

    await bouton.click();

    await expect(bouton).toBeHidden();
    expect(await page.locator('#taskList .task-row').count()).toBeLessThan(avant);
    await expect(page.locator('#taskList .tree-chevron.expanded')).toHaveCount(0);
});

test('sous 560 px, la barre d outils tient sur une ligne et laisse tomber le logo', async ({ page }) => {
    await D.ouvrirGantt(page, null, { largeur: 480, hauteur: 700 });

    const surUneLigne = await page.evaluate(() => {
        const boites = ['.header-left', '.header-center', '.header-right'].map((s) => document.querySelector(s).getBoundingClientRect());
        return boites.every((b) => b.top < boites[0].bottom && b.bottom > boites[0].top);
    });
    expect(surUneLigne).toBe(true);
    await expect(page.locator('.header h1')).toHaveCount(0);
});

// La colonne descend jusqu'à 140 px, largeur retrouvée d'une session à l'autre. Les badges d'une
// ligne y passaient à la ligne, le contenu débordait de la hauteur fixe de la ligne, et le panneau
// se lisait comme un empilement écrasé.
const colonneEtroite = { reglages: { taskflow_gantt_largeur_liste: '140' } };

test('colonne au minimum, le contenu d une ligne tient dans sa hauteur', async ({ page }) => {
    await D.ouvrirGantt(page, null, colonneEtroite);
    await D.toutDeplier(page);

    const debordent = await page.locator('#taskList .task-row').evaluateAll((lignes) => lignes
        .filter((ligne) => {
            const info = ligne.querySelector('.task-info');
            return info && info.scrollHeight > ligne.getBoundingClientRect().height;
        })
        .map((ligne) => ligne.querySelector('.task-name').textContent));
    expect(debordent).toEqual([]);
});
