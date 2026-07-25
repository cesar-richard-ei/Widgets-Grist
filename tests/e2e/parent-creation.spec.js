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
