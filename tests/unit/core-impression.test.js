'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/impression.js');

// La fiche imprimée tient sur une page : réduite au besoin, sans laisser de bande vide à droite.

const PAGE = { largeur: 1046, hauteur: 718 };
const echelle = (mesurer) => TF.echelleDImpression(Object.assign({ mesurer: mesurer }, PAGE));
const tient = (r, mesurer) => mesurer(r.largeur) * r.zoom <= PAGE.hauteur + 0.5;

test('une fiche qui tient part telle quelle', () => {
    assert.deepEqual(echelle(() => 500), { largeur: 1046, zoom: 1 });
});

test('une fiche deux fois trop haute est reduite de moitie', () => {
    const r = echelle(() => 1436);
    assert.ok(tient(r, () => 1436));
    assert.ok(r.zoom > 0.49 && r.zoom <= 0.5);
});

test('elargir la mise en page fait gagner de la hauteur', () => {
    const mesurer = (l) => 300 + (1046 * 900) / l;
    const r = echelle(mesurer);
    assert.ok(tient(r, mesurer));
    assert.ok(r.zoom > PAGE.hauteur / mesurer(1046));
    assert.ok(Math.abs(r.largeur * r.zoom - 1046) < 0.5);
});

test('le calcul s arrete apres quelques mesures', () => {
    let appels = 0;
    echelle((l) => { appels++; return 300 + (1046 * 900) / l; });
    assert.ok(appels <= 10, appels + ' mesures');
});

test('une fiche qui grandit en s elargissant tient quand meme', () => {
    const mesurer = (l) => 800 + (l - 1046) * 0.3;
    assert.ok(tient(echelle(mesurer), mesurer));
});
