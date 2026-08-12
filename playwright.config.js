'use strict';

const config = {
    testDir: './tests/e2e',
    timeout: 20000,
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: 'http://localhost:3001',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/serve-dev.js',
        url: 'http://localhost:3001/tasks_app/gantt.html',
        reuseExistingServer: !process.env.CI,
        timeout: 15000
    }
};

module.exports = config;
