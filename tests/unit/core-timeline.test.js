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

test('computeBarGeometry : position et largeur d une barre dans la fenetre', () => {
    const g = TF.computeBarGeometry({
        start: new Date(2026, 0, 1), tStart: new Date(2026, 0, 6), tEnd: new Date(2026, 0, 10), pxPerDay: 10
    });
    assert.equal(g.left, 50);          // 5 jours * 10
    assert.equal(g.width, 50);         // (4+1) jours * 10
    assert.equal(g.barLeft, 50);
    assert.equal(g.barWidth, 50);
    assert.equal(g.isNarrow, true);    // 50 < 60
    assert.equal(g.diamondLeft, 48);   // max(0, 50 + round(10/2) - 7)
});

test('computeBarGeometry : une barre commencant avant la fenetre est clampee a gauche', () => {
    const g = TF.computeBarGeometry({
        start: new Date(2026, 0, 10), tStart: new Date(2026, 0, 5), tEnd: new Date(2026, 0, 8), pxPerDay: 10
    });
    assert.equal(g.left, -50);
    assert.equal(g.barLeft, 0);        // max(0, -50)
    assert.equal(g.barWidth, 12);      // max(40 - 50, 12) = 12 (plancher)
});

test('computeTodayScroll : le debut de sur-colonne est cale quand la marge reste dans le premier tiers', () => {
    // Vue semestre : le mois courant commence a 9px, aujourd'hui est 150px plus loin,
    // pour 520px visibles (seuil 173px). Le calage sur le mois est conserve.
    const s = TF.computeTodayScroll({ colPx: 9, todayPx: 150, visibleWidth: 520 });
    assert.equal(s, 0);              // max(0, 9 - 12)
});

test('computeTodayScroll : au-dela du premier tiers, aujourd hui est ramene sur le seuil', () => {
    // Vue mois : le 1er du mois est au bord, aujourd'hui a 1020px, 520px visibles.
    const s = TF.computeTodayScroll({ colPx: 0, todayPx: 1020, visibleWidth: 520 });
    assert.equal(s, 847);            // 1020 - 520/3
});

test('computeTodayScroll : le seuil suit la largeur visible', () => {
    const etroit = TF.computeTodayScroll({ colPx: 0, todayPx: 900, visibleWidth: 600 });
    const large = TF.computeTodayScroll({ colPx: 0, todayPx: 900, visibleWidth: 1500 });
    assert.equal(etroit, 700);       // 900 - 200
    assert.equal(large, 400);        // 900 - 500
});

test('computeTodayScroll : sur une zone minuscule le seuil ne passe pas sous l ecart', () => {
    const s = TF.computeTodayScroll({ colPx: 0, todayPx: 300, visibleWidth: 24 });
    assert.equal(s, 288);            // seuil borne a l'ecart de 12px
});

test('computeTodayScroll : jamais de defilement negatif', () => {
    const s = TF.computeTodayScroll({ colPx: 4, todayPx: 4, visibleWidth: 800 });
    assert.equal(s, 0);
});

test('computeDependencyPath : chemin bezier et fleche entre deux taches', () => {
    const d = TF.computeDependencyPath({
        start: new Date(2026, 0, 1), depEnd: new Date(2026, 0, 5), tStart: new Date(2026, 0, 10),
        depIdx: 0, tIdx: 1, pxPerDay: 10
    });
    assert.equal(d.x1, 50);   // (4 jours * 10) + pxPerDay(10)
    assert.equal(d.y1, 22);   // 0*44 + 22
    assert.equal(d.x2, 90);   // 9 jours * 10
    assert.equal(d.y2, 66);   // 1*44 + 22
    assert.equal(d.midX, 70);
    assert.equal(d.pathD, 'M50,22 C70,22 70,66 90,66');
    assert.equal(d.arrowPoints, '90,66 84,62 84,70');
});
