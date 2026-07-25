'use strict';

const { test, expect } = require('./harness.js');

// Deplie la premiere branche parente repliee et renvoie son chevron.
async function deplierUneBranche(page) {
    const chevron = page.locator('#taskList .task-row.parent .tree-chevron').first();
    await expect(chevron).toBeVisible();
    await chevron.click();
    return chevron;
}

test('le bouton replier-tout reste cache tant qu aucune branche n est depliee', async ({ gantt }) => {
    await expect(gantt.locator('#collapseAllBtn')).toBeHidden();
});

test('deplier une branche fait apparaitre le bouton replier-tout', async ({ gantt }) => {
    await deplierUneBranche(gantt);
    await expect(gantt.locator('#collapseAllBtn')).toBeVisible();
});

test('le bouton replier-tout referme toutes les branches et se recache', async ({ gantt }) => {
    await deplierUneBranche(gantt);
    await expect(gantt.locator('#collapseAllBtn')).toBeVisible();
    const avant = await gantt.locator('#taskList .task-row').count();

    await gantt.locator('#collapseAllBtn').click();

    const resteDepliee = await gantt.evaluate(() =>
        tasks.some(t => getChildren(t.id).length && expandedTasks.has(t.id)));
    expect(resteDepliee).toBe(false);
    await expect(gantt.locator('#collapseAllBtn')).toBeHidden();
    expect(await gantt.locator('#taskList .task-row').count()).toBeLessThan(avant);
});
