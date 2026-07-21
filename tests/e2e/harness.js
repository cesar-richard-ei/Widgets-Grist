'use strict';

const path = require('path');
const base = require('@playwright/test');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le document de depart est vide : ensureSchema() puis seedData() du widget construisent
// eux-memes les tables et les donnees. Rien a maintenir cote fixture, et le chemin reel
// d'initialisation est exerce a chaque test.
const test = base.test.extend({
    gantt: async ({ page }, use) => {
        // La vraie API Grist definirait window.grist et ecraserait le simulacre.
        await page.route('**/grist-plugin-api.js', (route) => route.abort());

        await page.addInitScript({ path: CHEMIN_SIMULACRE });
        await page.addInitScript(() => { window.grist = window.createFakeGrist({}); });

        await page.goto('/tasks_app/gantt.html');
        await page.waitForSelector('#taskList .task-row');
        await use(page);
    }
});

module.exports = { test: test, expect: base.expect };
