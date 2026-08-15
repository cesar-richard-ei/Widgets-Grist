'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Ce que le Gantt affiche à l'ouverture, et d'où les lignes tirent leur couleur. Les réglages
// d'affichage vivent le temps de la session : ils ne sont pas relus d'un stockage local, pour que
// chacun retrouve les mêmes défauts en rouvrant.

const rgb = (hex) => {
    const [, r, g, b] = /#(..)(..)(..)/.exec(hex);
    return 'rgb(' + [r, g, b].map((v) => parseInt(v, 16)).join(', ') + ')';
};

const fondDeLaBarre = (page, titre) => page.evaluate((t) => {
    const ligne = Array.from(document.querySelectorAll('#taskList .task-row')).find((l) => l.textContent.includes(t));
    const barre = ligne && document.querySelector('#timelineGrid .gantt-bar[data-id="' + ligne.dataset.id + '"]');
    return barre ? barre.style.background : null;
}, titre);

test('à l ouverture : tri par date, vue semestre, couleur par responsable', async ({ page }) => {
    await D.ouvrirGantt(page);

    await expect(page.locator('#sortSelect')).toHaveValue('date');
    await expect(page.locator('.view-controls .btn.active')).toHaveAttribute('data-view', 'semester');
    await expect(page.locator('#colorSelect')).toHaveValue('responsable');
    expect(await page.locator('#colorSelect option').first().getAttribute('value')).toBe('responsable');
});

test('les réglages d affichage ne survivent pas au rechargement', async ({ page }) => {
    await D.ouvrirGantt(page, null, {
        // Des valeurs d'une session précédente ne doivent pas être reprises.
        reglages: { taskflow_gantt_colormode: 'status', taskflow_gantt_sort: 'priority', taskflow_gantt_view: 'week' }
    });

    await expect(page.locator('#sortSelect')).toHaveValue('date');
    await expect(page.locator('#colorSelect')).toHaveValue('responsable');
    await expect(page.locator('.view-controls .btn.active')).toHaveAttribute('data-view', 'semester');

    await page.selectOption('#sortSelect', 'priority');
    await expect(page.locator('#sortSelect')).toHaveValue('priority');

    await page.reload();
    await page.waitForSelector('#taskList .task-row');

    await expect(page.locator('#sortSelect')).toHaveValue('date');
});

test('sans colonne Responsable, le mode par projet reprend la main', async ({ page }) => {
    await D.ouvrirGantt(page, D.sansColonne(D.documentCible(), 'Responsable'));

    await expect(page.locator('#colorSelect')).toHaveValue('project');
    await expect(page.locator('#colorSelect option[value="responsable"]')).toHaveCount(0);
});

test('une ligne prend la couleur de son responsable, pas celle de ses contributeurs', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    // Chantier et tâche ont Bruno pour responsable ; la tâche a d'autres contributeurs.
    expect(await fondDeLaBarre(page, 'Socle technique')).toContain(rgb(D.COULEURS.vert));
    expect(await fondDeLaBarre(page, 'Cadrage des outils')).toContain(rgb(D.COULEURS.vert));
    expect(await fondDeLaBarre(page, 'Cadrage des outils')).not.toContain(rgb(D.COULEURS.bleu));
});

test('une ligne sans responsable reste neutre', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);

    const fond = await fondDeLaBarre(page, 'Recette');
    for (const couleur of Object.values(D.COULEURS)) expect(fond).not.toContain(rgb(couleur));
});

// grist.onRecords ne notifie que Tasks : sans relecture au retour, une couleur d'équipe modifiée
// dans le document resterait périmée jusqu'au rechargement de la page.
test('changer une couleur d équipe est repris au retour sur le widget', async ({ page }) => {
    await D.ouvrirGantt(page);
    expect(await fondDeLaBarre(page, 'Socle technique')).toContain(rgb(D.COULEURS.vert));

    await page.evaluate((violet) => window.grist.docApi.applyUserActions([['UpdateRecord', 'Team', 2, { couleur: violet }]]), D.COULEURS.violet);
    // Rien ne bouge tant que le widget n'a pas perdu puis repris la main.
    expect(await fondDeLaBarre(page, 'Socle technique')).toContain(rgb(D.COULEURS.vert));

    await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });

    await expect.poll(() => fondDeLaBarre(page, 'Socle technique')).toContain(rgb(D.COULEURS.violet));
});
