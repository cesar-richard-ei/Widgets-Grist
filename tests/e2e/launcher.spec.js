'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
    // On coupe l'API Grist pour que le chargement des iframes enfants ne dépende pas du réseau ; seule la barre d'onglets est testée.
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
});

async function ongletsVisibles(page) {
    return page.$$eval('#navbar .tab[data-id]', (els) => els.map((e) => e.dataset.id));
}

test('par defaut, seuls Gantt et Plan sont affiches', async ({ page }) => {
    await page.goto('/tasks_app/index.html');
    expect(await ongletsVisibles(page)).toEqual(['gantt', 'plan']);
});

test('?tabs= impose la liste et son ordre', async ({ page }) => {
    await page.goto('/tasks_app/index.html?tabs=kanban,gantt');
    expect(await ongletsVisibles(page)).toEqual(['kanban', 'gantt']);
});

test('un ?tabs= vide de valeurs connues retombe sur le defaut', async ({ page }) => {
    await page.goto('/tasks_app/index.html?tabs=inconnu');
    expect(await ongletsVisibles(page)).toEqual(['gantt', 'plan']);
});
