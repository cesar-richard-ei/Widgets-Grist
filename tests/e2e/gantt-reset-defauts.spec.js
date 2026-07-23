'use strict';

const path = require('path');
const { test, expect } = require('@playwright/test');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Prepare le widget avec un localStorage donne, puis ouvre le Gantt. addInitScript s'execute
// avant les scripts de la page, donc le localStorage est en place quand la bascule s'evalue.
async function ouvrirAvecStorage(page, entrees) {
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript(() => { window.grist = window.createFakeGrist({}); });
    await page.addInitScript((kv) => {
        Object.keys(kv).forEach((k) => localStorage.setItem(k, kv[k]));
    }, entrees);
    await page.goto('/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
}

test('un utilisateur avec d\'anciennes preferences bascule une fois vers les nouveaux defauts', async ({ page }) => {
    await ouvrirAvecStorage(page, {
        taskflow_gantt_view: 'month',
        taskflow_gantt_sort: 'priority',
        taskflow_gantt_colormode: 'priority'
        // pas de flag taskflow_gantt_defaults : la bascule doit s'appliquer
    });
    await expect(page.locator('#sortSelect')).toHaveValue('date');
    await expect(page.locator('#colorSelect')).toHaveValue('project');
    await expect(page.locator('.view-controls .btn.active')).toHaveAttribute('data-view', 'semester');
});

test('une fois la bascule faite, les choix deliberes de l\'utilisateur sont conserves', async ({ page }) => {
    await ouvrirAvecStorage(page, {
        taskflow_gantt_view: 'week',
        taskflow_gantt_sort: 'manual',
        taskflow_gantt_colormode: 'status',
        taskflow_gantt_defaults: '2'  // bascule deja appliquee : on ne re-force pas
    });
    await expect(page.locator('#sortSelect')).toHaveValue('manual');
    await expect(page.locator('#colorSelect')).toHaveValue('status');
    await expect(page.locator('.view-controls .btn.active')).toHaveAttribute('data-view', 'week');
});
