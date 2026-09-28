'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { construire } = require('../../scripts/build-site.js');

const RACINE = path.join(__dirname, '..', '..');
const BASE = 'https://exemple.github.io/Widgets-Grist';

function dossierTemporaire() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
}

test('le site sert chaque widget depuis sa source de projects/', () => {
    const destination = dossierTemporaire();
    construire({ destination, baseUrl: BASE });

    const lire = (p) => fs.readFileSync(p, 'utf8');
    assert.equal(lire(path.join(destination, 'taskflow/fiche/index.html')), lire(path.join(RACINE, 'projects/tasks_app/fiche.html')));
    assert.equal(lire(path.join(destination, 'taskflow/gantt/index.html')), lire(path.join(RACINE, 'projects/tasks_app/gantt.html')));
    assert.ok(fs.existsSync(path.join(destination, 'capacity/index.html')));
});

test('le manifest annonce les widgets du catalogue sous l adresse de base', () => {
    const destination = dossierTemporaire();
    construire({ destination, baseUrl: BASE + '/dev' });

    const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
    const fiche = manifest.find((w) => w.widgetId === 'taskflow-fiche');
    assert.equal(fiche.url, BASE + '/dev/taskflow/fiche/');
    assert.ok(manifest.every((w) => w.url.startsWith(BASE + '/dev/taskflow/')));
});

test('une source absente fait echouer la construction', () => {
    const racine = dossierTemporaire();
    fs.writeFileSync(path.join(racine, 'site.json'), JSON.stringify({ demo: { fichiers: { 'index.html': 'projects/absent.html' } } }));

    assert.throws(() => construire({ racine, destination: dossierTemporaire(), baseUrl: BASE }), /projects\/absent\.html/);
});
