'use strict';

const { test, expect } = require('./harness.js');

// Ouvre la premiere ligne visible et renvoie son data-id : la liste est triee par
// sortTasks() et la hierarchie WBS replie certaines lignes, donc l'identifiant de la
// premiere ligne affichee ne correspond pas forcement au premier enregistrement de la table.
async function ouvrirPremiereTache(page) {
    const premiereLigne = page.locator('#taskList .task-row').first();
    const id = Number(await premiereLigne.getAttribute('data-id'));
    await premiereLigne.click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
    return id;
}

test('cliquer une tache ouvre le panneau et decale le Gantt', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await expect(gantt.locator('#ganttWrapper')).toHaveClass(/panel-open/);
    await expect(gantt.locator('#taskTitle')).toBeVisible();
});

test('la croix ferme le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#panelHeader .panel-close').click();
    await expect(gantt.locator('#panel')).not.toHaveClass(/open/);
});

test('la touche Echap ferme le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.keyboard.press('Escape');
    await expect(gantt.locator('#panel')).not.toHaveClass(/open/);
});

test('changer le statut persiste immediatement', async ({ gantt }) => {
    const id = await ouvrirPremiereTache(gantt);
    await gantt.locator('.status-pill[data-status="done"]').click();
    await expect(gantt.locator('#saveIndicator')).toHaveClass(/visible/);

    // Retrouve l'enregistrement par son identifiant plutot que par position : le tri de
    // la liste ne garantit aucune correspondance entre l'ordre affiche et l'ordre en table.
    const statut = await gantt.evaluate(async (taskId) => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        const index = t.id.indexOf(taskId);
        return t.statut[index];
    }, id);
    expect(statut).toBe('done');
});

test('les fleches naviguent entre les taches', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    const premier = await gantt.locator('#taskTitle').inputValue();
    await gantt.locator('#panelHeader .panel-nav-btn').last().click();
    const suivant = await gantt.locator('#taskTitle').inputValue();
    expect(suivant).not.toBe(premier);
});
