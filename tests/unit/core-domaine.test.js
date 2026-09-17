'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/taskflow-core.js');

const equipe = [
    { id: 1, Domaine: 'Pilotage', couleur: '#3e5de7' },
    { id: 2, Domaine: 'Socle technique', couleur: '#10b981' },
    { id: 3, Domaine: 'Socle technique', couleur: '#ef4444' },
    { id: 4, Domaine: 'Données' }
];

test('un domaine prend la couleur de son premier membre', () => {
    assert.equal(TF.couleurDeDomaine(equipe, 'Socle technique'), '#10b981');
});

test('un membre sans couleur donne la couleur par defaut des personnes', () => {
    assert.equal(TF.couleurDeDomaine(equipe, 'Données'), '#3e5de7');
});

test('un domaine que personne ne porte a sa propre couleur de repli', () => {
    assert.equal(TF.couleurDeDomaine(equipe, 'Inconnu'), '#6366f1');
    assert.equal(TF.couleurDeDomaine([], 'Pilotage'), '#6366f1');
});
