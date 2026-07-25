'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/taskflow-core.js');

test('computeTimelineScale : vue jour sans tache renvoie l echelle de la periode', () => {
    const s = TF.computeTimelineScale({
        tasks: [], unit: 'day', cellWidth: 40,
        viewStart: new Date(2026, 0, 1), viewDays: 30, availableWidth: 600
    });
    assert.equal(s.effectiveDays, 30);
    assert.equal(s.numCells, 30);
    assert.equal(s.cellWidth, 40);          // max(40, floor(600/30)=20)
    assert.equal(s.pxPerDay, 40);
    assert.equal(s.effectiveStart.getFullYear(), 2026);
    assert.equal(s.effectiveStart.getMonth(), 0);
    assert.equal(s.effectiveStart.getDate(), 1);
});

test('computeTimelineScale : une tache debordante etend la plage avec padding', () => {
    const s = TF.computeTimelineScale({
        tasks: [{ start: new Date(2026, 0, 5), end: new Date(2026, 1, 10) }], // fin au-delà de Jan 31
        unit: 'day', cellWidth: 40,
        viewStart: new Date(2026, 0, 1), viewDays: 30, availableWidth: 600
    });
    // eEnd étendu à Feb 10 + 3 jours de padding → effectiveDays > 30
    assert.ok(s.effectiveDays > 30, 'la plage doit être étendue');
    assert.equal(s.numCells, s.effectiveDays); // vue jour : 1 cellule = 1 jour
});

test('computeTimelineScale : largeur de cellule remplit l espace disponible', () => {
    const s = TF.computeTimelineScale({
        tasks: [], unit: 'day', cellWidth: 10,
        viewStart: new Date(2026, 0, 1), viewDays: 10, availableWidth: 1000
    });
    assert.equal(s.cellWidth, 100); // max(10, floor(1000/10)=100)
    assert.equal(s.pxPerDay, 100);
});
