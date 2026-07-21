'use strict';

const { test, expect } = require('./harness.js');

async function ouvrirPremiereTache(page) {
    await page.locator('#taskList .task-row').first().click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

// Ouvre la ligne visible a l'indice donne (0-based) et renvoie son data-id.
async function ouvrirTacheAIndice(page, indice) {
    const ligne = page.locator('#taskList .task-row').nth(indice);
    const id = Number(await ligne.getAttribute('data-id'));
    await ligne.click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    return id;
}

// Lit une colonne de la table Tasks pour un identifiant donne, via le simulacre.
async function lireChampTache(page, id, colonne) {
    return page.evaluate(async ({ taskId, col }) => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t[col][t.id.indexOf(taskId)];
    }, { taskId: id, col: colonne });
}

test('cliquer une autre tache bascule le panneau sans le fermer', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    const premier = await gantt.locator('#taskTitle').inputValue();

    await gantt.locator('#taskList .task-row').nth(1).click();

    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    const second = await gantt.locator('#taskTitle').inputValue();
    expect(second).not.toBe(premier);
});

test('le Gantt reste cliquable quand le panneau est ouvert', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#timelineGrid .gantt-bar').first().click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
});

test('la barre d outils reste utilisable quand le panneau est ouvert', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('.view-controls .btn[data-view="month"]').click();
    await expect(gantt.locator('.view-controls .btn[data-view="month"]')).toHaveClass(/active/);
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
});

test('la timeline defile quand le panneau est ouvert', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#timelineScroll').evaluate((el) => { el.scrollLeft = 200; });
    const position = await gantt.locator('#timelineScroll').evaluate((el) => el.scrollLeft);
    expect(position).toBeGreaterThan(0);
});

test('aucun calque ne recouvre le Gantt', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await expect(gantt.locator('#panelOverlay')).toHaveCount(0);
});

test('changer de tache panneau ouvert persiste la modification en attente', async ({ gantt }) => {
    const premierId = await ouvrirTacheAIndice(gantt, 0);
    await gantt.locator('#taskDescription').fill('Description modifiee avant bascule');

    await gantt.locator('#taskList .task-row').nth(1).click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);

    const description = await lireChampTache(gantt, premierId, 'description');
    expect(description).toBe('Description modifiee avant bascule');
});
