'use strict';

const config = {
    testDir: './tests/e2e',
    timeout: 20000,
    use: {
        baseURL: 'http://localhost:3001',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/serve-dev.js',
        url: 'http://localhost:3001/tasks_app/gantt.html',
        reuseExistingServer: true,
        timeout: 15000
    }
};

module.exports = config;
