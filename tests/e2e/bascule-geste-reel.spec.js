'use strict';

const { test, expect } = require('./harness.js');

// Lit une colonne de la table Tasks pour un identifiant donne, via le simulacre.
async function lireChampTache(page, id, colonne) {
    return page.evaluate(async ({ taskId, col }) => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t[col][t.id.indexOf(taskId)];
    }, { taskId: id, col: colonne });
}

// Ces deux tests reproduisent le geste utilisateur reel : clic pour donner le focus au
// champ, frappe clavier (keyboard.type, pas fill), puis un unique clic souris sur une
// autre tache. Un fill() suivi d'un clic ne declenche pas le meme enchainement d'evenements
// natifs et ne reproduit pas la panne observee (bascule qui exige un second clic).

test('taper dans le titre puis cliquer une autre ligne bascule le panneau des le premier clic', async ({ gantt }) => {
    const premiereLigne = gantt.locator('#taskList .task-row').first();
    await premiereLigne.click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);

    const champTitre = gantt.locator('#taskTitle');
    await champTitre.click();
    await champTitre.press('End');
    await gantt.keyboard.type(' revise au clavier');

    const deuxiemeLigne = gantt.locator('#taskList .task-row').nth(1);
    const deuxiemeId = Number(await deuxiemeLigne.getAttribute('data-id'));
    const titreAttendu = await lireChampTache(gantt, deuxiemeId, 'titre');

    await deuxiemeLigne.click();

    const titreAffiche = await champTitre.inputValue();
    expect(titreAffiche).toBe(titreAttendu);
});

test('taper dans la description puis cliquer une autre barre bascule le panneau des le premier clic', async ({ gantt }) => {
    const premiereBarre = gantt.locator('#timelineGrid .gantt-bar').first();
    await premiereBarre.click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);

    const champDescription = gantt.locator('#taskDescription');
    await champDescription.click();
    await champDescription.press('End');
    await gantt.keyboard.type('Note ajoutee au clavier');

    const deuxiemeBarre = gantt.locator('#timelineGrid .gantt-bar').nth(1);
    const deuxiemeId = Number(await deuxiemeBarre.getAttribute('data-id'));
    const titreAttendu = await lireChampTache(gantt, deuxiemeId, 'titre');

    await deuxiemeBarre.click();

    const titreAffiche = await gantt.locator('#taskTitle').inputValue();
    expect(titreAffiche).toBe(titreAttendu);
});
