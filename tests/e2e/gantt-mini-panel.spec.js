'use strict';

const { test, expect } = require('./harness.js');

test('le panneau d une tache parente affiche un mini Gantt de son sous-arbre', async ({ gantt }) => {
    await gantt.evaluate(() => { const p = tasks.find(t => getChildren(t.id).length > 0); openTaskPanel(p.id); });
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    await expect(gantt.locator('.mg-canvas')).toHaveCount(1);
    const marks = await gantt.locator('.mg-canvas .mg-bar, .mg-canvas .mg-milestone').count();
    expect(marks).toBeGreaterThan(1); // le parent + ses sous-tâches
    await expect(gantt.locator('.mg-left .mg-name').first()).toBeVisible();     // colonne de noms
    await expect(gantt.locator('.mg-time-header .mg-month').first()).toBeVisible(); // en-tête de mois
});

test('le panneau d une sous-tache affiche le Gantt du parent avec elle surlignee', async ({ gantt }) => {
    const titre = await gantt.evaluate(() => {
        const l = tasks.find(t => getChildren(t.id).length === 0 && t.parentTask);
        openTaskPanel(l.id);
        return l.titre;
    });
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    await expect(gantt.locator('.mg-canvas')).toHaveCount(1);
    const hl = gantt.locator('.mg-name.hl');
    await expect(hl).toHaveCount(1);
    await expect(hl).toHaveText(titre); // la ligne surlignée est bien la tâche courante
});

test('les dates a l epoch (1970) sont ignorees dans le mini Gantt', async ({ gantt }) => {
    await gantt.evaluate(() => {
        const p = tasks.find(t => getChildren(t.id).length > 0);
        p.dateDebut = 0; p.dateEcheance = 0;              // parent non daté
        const kid = getChildren(p.id)[0];
        kid.dateDebut = 0; kid.dateEcheance = 0;          // un enfant non daté
        openTaskPanel(p.id);
    });
    await expect(gantt.locator('.mg-canvas')).toHaveCount(1); // les autres enfants sont datés
    const months = await gantt.locator('.mg-time-header .mg-month').allInnerTexts();
    expect(months.some(m => /\b70\b/.test(m))).toBe(false);   // aucun mois de 1970
});

test('le panneau d une tache feuille sans parent n affiche pas de mini Gantt', async ({ gantt }) => {
    await gantt.evaluate(() => { const l = tasks.find(t => getChildren(t.id).length === 0 && !t.parentTask); openTaskPanel(l.id); });
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    await expect(gantt.locator('.mg-canvas')).toHaveCount(0);
});
