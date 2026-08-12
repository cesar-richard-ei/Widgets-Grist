'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifier } = require('../../scripts/check-commits.js');

test('verifier accepte les entetes conventionnelles du depot', () => {
    assert.equal(verifier('feat(gantt): grouper les chantiers par projet'), null);
    assert.equal(verifier('fix: corriger le calage'), null);
    assert.equal(verifier('chore(ci): epingler les actions'), null);
    assert.equal(verifier('feat(api)!: renommer le champ statut'), null);
});

test('verifier laisse passer un revert produit par git', () => {
    assert.equal(verifier('Revert "feat(gantt): grouper les chantiers"'), null);
});

test('verifier refuse une entete hors convention', () => {
    assert.match(verifier('correction rapide du calendrier'), /hors convention/);
    assert.match(verifier('feat gantt: sans deux-points'), /hors convention/);
    assert.match(verifier('fix:pas d espace'), /hors convention/);
});

test('verifier refuse un type inconnu', () => {
    assert.match(verifier('feature(gantt): mauvais type'), /type inconnu/);
    assert.match(verifier('bugfix: mauvais type'), /type inconnu/);
});

test('verifier refuse une entete trop longue', () => {
    assert.match(verifier(`fix(gantt): ${'a'.repeat(95)}`), /100 au maximum/);
});

test('verifier ne juge que l entete', () => {
    assert.equal(verifier('fix(plan): nommer la table\n\nUn corps libre, sans contrainte de format.'), null);
});
