'use strict';

const path = require('path');
const { test, expect } = require('./harness.js');

test('un filtre pose est persiste en localStorage sous la cle du document', async ({ gantt }) => {
    await gantt.evaluate(() => toggleFilter('priority', 1));
    const raw = await gantt.evaluate(() => localStorage.getItem('taskflow_gantt_filters:' + filterDocId));
    expect(JSON.parse(raw).priority).toEqual([1]);
});

test('au rechargement, le filtre est restaure depuis localStorage', async ({ gantt }) => {
    await gantt.evaluate(() => toggleFilter('priority', 1));
    await gantt.reload();
    await gantt.waitForSelector('#taskList .task-row');
    expect(await gantt.evaluate(() => filters.priority)).toEqual([1]);
});

test('un id projet absent des donnees est ignore a l application, la priorite reste', async ({ gantt }) => {
    await gantt.evaluate(() => { filters.project = [99999]; filters.priority = [1]; });
    const eff = await gantt.evaluate(() => effectiveFilters());
    expect(eff.project).toEqual([]);
    expect(eff.priority).toEqual([1]);
});

test('localStorage fait foi : l amorcage onOptions de la section n ecrase pas', async ({ page }) => {
    await page.route('**/grist-plugin-api.js', (r) => r.abort());
    await page.addInitScript({ path: path.join(__dirname, '..', 'fake-grist.js') });
    await page.addInitScript(() => {
        localStorage.setItem('taskflow_gantt_filters:fake-doc', JSON.stringify({ project: [], assignee: [], priority: [1] }));
        window.grist = window.createFakeGrist({}, { options: { filters: { project: [], assignee: [], priority: [2] } } });
    });
    await page.goto('/tasks_app/gantt.html');
    await page.waitForSelector('#taskList .task-row');
    expect(await page.evaluate(() => filters.priority)).toEqual([1]);
});

test('un evenement storage sur la cle re-hydrate les filtres', async ({ gantt }) => {
    await gantt.evaluate(() => {
        localStorage.setItem('taskflow_gantt_filters:' + filterDocId, JSON.stringify({ project: [], assignee: [], priority: [3] }));
        window.dispatchEvent(new StorageEvent('storage', { key: filterStorageKey() }));
    });
    expect(await gantt.evaluate(() => filters.priority)).toEqual([3]);
});
