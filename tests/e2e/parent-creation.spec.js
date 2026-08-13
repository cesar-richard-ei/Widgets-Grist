'use strict';

const { test, expect } = require('./harness.js');

async function ouvrirCreation(page) {
    await page.locator('#btnAjouter').click();
    const menu = page.locator('#menuAjout');
    if (await menu.isVisible()) await menu.locator('button', { hasText: 'Tâche' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

test('le champ Parent apparait dans le formulaire de creation', async ({ gantt }) => {
    await ouvrirCreation(gantt);
    await expect(gantt.locator('#panelContent .prop-row', { hasText: 'Parent' })).toBeVisible();
    await expect(gantt.locator('#parentSelect')).toHaveCount(1);
});

test('les parents proposes en creation sont limites au projet courant', async ({ gantt }) => {
    await ouvrirCreation(gantt);
    const okFiltre = await gantt.evaluate(() => {
        const proj = panelState.editData.projet || null;
        const ids = Array.from(document.querySelectorAll('#parentSelect .multi-select-option'))
            .map(o => Number((o.getAttribute('onclick').match(/setParent\((\d+)\)/) || [])[1]));
        return ids.length > 0 && ids.every(id => {
            const t = tasks.find(x => x.id === id);
            return t && (t.projet || null) === proj;
        });
    });
    expect(okFiltre).toBe(true);
});

test('choisir un parent en creation le pose et il persiste', async ({ gantt }) => {
    await ouvrirCreation(gantt);
    await gantt.locator('#taskTitle').fill('Enfant test parent');

    await gantt.locator('#parentSelect .addbtn').click();
    const premiere = gantt.locator('#parentSelect .multi-select-option').first();
    const parentId = await premiere.evaluate(o => Number((o.getAttribute('onclick').match(/setParent\((\d+)\)/) || [])[1]));
    await premiere.click();

    await expect(gantt.getByRole('button', { name: 'Détacher' })).toBeVisible();

    await gantt.getByRole('button', { name: 'Créer la tâche' }).click();

    const ok = await gantt.evaluate((pid) => {
        const t = tasks.find(x => x.titre === 'Enfant test parent');
        return !!t && t.parentTask === pid;
    }, parentId);
    expect(ok).toBe(true);
});
