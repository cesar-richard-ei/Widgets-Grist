'use strict';

const { test, expect } = require('./harness.js');

async function ouvrirCreation(page) {
    await page.getByRole('button', { name: '+ Tâche' }).click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

test('le champ Parent apparait dans le formulaire de creation', async ({ gantt }) => {
    await ouvrirCreation(gantt);
    await expect(gantt.locator('#panelContent .prop-row', { hasText: 'Parent' })).toBeVisible();
});

test('les parents proposes sont limites au projet courant', async ({ gantt }) => {
    await ouvrirCreation(gantt);
    const okFiltre = await gantt.evaluate(() => {
        const p = projects[0];
        panelState.editData.projet = p.id;
        const cands = parentCandidates();
        return cands.length > 0 && cands.every(t => (t.projet || null) === (p.id || null));
    });
    expect(okFiltre).toBe(true);
});

test('taper filtre la liste des parents', async ({ gantt }) => {
    await gantt.getByRole('button', { name: '+ Tâche' }).click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);

    await gantt.locator('#parentSearch').click();
    const total = await gantt.locator('#parentComboList .parent-opt').count();
    expect(total).toBeGreaterThan(0);

    // Correspondance positive : un prefixe d'un titre reel garde au moins cette option.
    const titre = await gantt.locator('#parentComboList .parent-opt').first().textContent();
    await gantt.locator('#parentSearch').fill(titre.slice(0, 3));
    const visiblesMatch = await gantt.locator('#parentComboList .parent-opt:visible').count();
    expect(visiblesMatch).toBeGreaterThan(0);

    // Aucune correspondance : tout est masque.
    await gantt.locator('#parentSearch').fill('zzz_aucune_correspondance');
    const visiblesNone = await gantt.locator('#parentComboList .parent-opt:visible').count();
    expect(visiblesNone).toBe(0);
});

test('choisir un parent le pose et il persiste a la creation', async ({ gantt }) => {
    await gantt.getByRole('button', { name: '+ Tâche' }).click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    await gantt.locator('#taskTitle').fill('Enfant test parent');

    await gantt.locator('#parentSearch').click();
    const premiere = gantt.locator('#parentComboList .parent-opt').first();
    const parentId = Number(await premiere.getAttribute('data-id'));
    await premiere.click();

    await expect(gantt.getByRole('button', { name: 'Détacher' })).toBeVisible();

    await gantt.getByRole('button', { name: 'Créer la tâche' }).click();

    const ok = await gantt.evaluate((pid) => {
        const t = tasks.find(x => x.titre === 'Enfant test parent');
        return !!t && t.parentTask === pid;
    }, parentId);
    expect(ok).toBe(true);
});
