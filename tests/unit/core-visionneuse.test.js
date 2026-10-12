'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/visionneuse.js');

// Le visuel agrandi part ajusté au cadre, se zoome autour du pointeur et ne quitte jamais le cadre.

const CADRE = { largeur: 1000, hauteur: 600 };
const IMAGE = { largeur: 2000, hauteur: 1000 };
const proche = (a, b) => Math.abs(a - b) < 1e-6;

test('ajuste et centre l image dans le cadre', () => {
    assert.deepEqual(TF.ajusterVisuel(CADRE, IMAGE), { echelle: 0.5, x: 0, y: 50 });
});

test('agrandit une image plus petite que le cadre', () => {
    assert.deepEqual(TF.ajusterVisuel(CADRE, { largeur: 500, hauteur: 200 }), { echelle: 2, x: 0, y: 100 });
});

test('le point sous le pointeur reste en place pendant le zoom', () => {
    const depart = TF.ajusterVisuel(CADRE, IMAGE);
    const point = { x: 300, y: 200 };
    const avant = { x: (point.x - depart.x) / depart.echelle, y: (point.y - depart.y) / depart.echelle };
    const e = TF.zoomerVisuel(depart, 2, point, CADRE, IMAGE);
    assert.equal(e.echelle, 1);
    assert.ok(proche(e.x + avant.x * e.echelle, point.x));
    assert.ok(proche(e.y + avant.y * e.echelle, point.y));
});

test('le zoom reste entre l image ajustee et cinq fois plus', () => {
    const depart = TF.ajusterVisuel(CADRE, IMAGE);
    assert.deepEqual(TF.zoomerVisuel(depart, 0.5, { x: 10, y: 10 }, CADRE, IMAGE), depart);
    assert.equal(TF.zoomerVisuel(depart, 100, { x: 10, y: 10 }, CADRE, IMAGE).echelle, 2.5);
});

test('une image plus grande que le cadre ne laisse pas de bord vide en se deplacant', () => {
    const zoomee = TF.zoomerVisuel(TF.ajusterVisuel(CADRE, IMAGE), 2, { x: 500, y: 300 }, CADRE, IMAGE);
    assert.deepEqual(TF.deplacerVisuel(zoomee, 5000, 5000, CADRE, IMAGE), { echelle: 1, x: 0, y: 0 });
    assert.deepEqual(TF.deplacerVisuel(zoomee, -5000, -5000, CADRE, IMAGE), { echelle: 1, x: -1000, y: -400 });
});

test('une image ajustee ne se deplace pas', () => {
    const depart = TF.ajusterVisuel(CADRE, IMAGE);
    assert.deepEqual(TF.deplacerVisuel(depart, 200, 200, CADRE, IMAGE), depart);
});
