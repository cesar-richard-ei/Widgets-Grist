'use strict';

const { test, expect } = require('./harness.js');

// Contexte Playwright neuf a chaque test : localStorage vierge, donc les valeurs par defaut
// s'appliquent (aucune preference utilisateur memorisee).
test('a la premiere ouverture : tri Date, couleur Projet, vue Semestre', async ({ gantt }) => {
    await expect(gantt.locator('#sortSelect')).toHaveValue('date');
    await expect(gantt.locator('#colorSelect')).toHaveValue('project');
    await expect(gantt.locator('.view-controls .btn.active')).toHaveAttribute('data-view', 'semester');
});
