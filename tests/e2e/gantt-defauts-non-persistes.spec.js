'use strict';

const path = require('path');
const { test, expect } = require('@playwright/test');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

async function ouvrir(page, storage) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript(() => { window.grist = window.createFakeGrist({}); });
    if (storage) {
        await page.addInitScript((kv) => { Object.keys(kv).forEach((k) => localStorage.setItem(k, kv[k])); }, storage);
    }
    await page.goto('/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

test("d'anciennes valeurs en localStorage sont ignorees : ouverture sur les defauts", async ({ page }) => {
    await ouvrir(page, {
        taskflow_gantt_view: 'month',
        taskflow_gantt_sort: 'priority',
        taskflow_gantt_colormode: 'priority'
    });
    await expect(page.locator('#sortSelect')).toHaveValue('date');
    await expect(page.locator('#colorSelect')).toHaveValue('project');
    await expect(page.locator('.view-controls .btn.active')).toHaveAttribute('data-view', 'semester');
});

test('un changement en session est perdu au rechargement, les defauts reviennent', async ({ page }) => {
    await ouvrir(page);
    await page.selectOption('#sortSelect', 'priority');
    await page.selectOption('#colorSelect', 'status');
    await expect(page.locator('#sortSelect')).toHaveValue('priority');

    await page.reload();
    await page.waitForSelector('#taskList .task-row');
    await expect(page.locator('#sortSelect')).toHaveValue('date');
    await expect(page.locator('#colorSelect')).toHaveValue('project');
});
