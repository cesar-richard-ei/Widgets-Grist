'use strict';

const { test, expect } = require('./harness.js');

test('le panneau d une tache parente affiche un mini Gantt du sous-arbre', async ({ gantt }) => {
    await gantt.evaluate(() => { const p = tasks.find(t => getChildren(t.id).length > 0); openTaskPanel(p.id); });
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    await expect(gantt.locator('.mini-gantt-canvas')).toHaveCount(1);
    const marks = await gantt.locator('.mini-gantt-canvas .gantt-bar, .mini-gantt-canvas .gantt-milestone').count();
    expect(marks).toBeGreaterThan(1); // le parent + ses sous-tâches
});

test('le panneau d une tache feuille n affiche pas de mini Gantt', async ({ gantt }) => {
    await gantt.evaluate(() => { const l = tasks.find(t => getChildren(t.id).length === 0 && !t.parentTask); openTaskPanel(l.id); });
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    await expect(gantt.locator('.mini-gantt-canvas')).toHaveCount(0);
});
