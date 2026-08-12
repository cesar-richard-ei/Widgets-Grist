'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { latestStable, bumpFor, highestBump, nextVersion } = require('../../scripts/next-version.js');

test('bumpFor classe feat en minor et fix en patch', () => {
    assert.equal(bumpFor('feat(gantt): grouper les chantiers par projet'), 'minor');
    assert.equal(bumpFor('fix(plan): nommer la table qui ne repond pas'), 'patch');
});

test('bumpFor traite chore, docs et test comme du patch', () => {
    assert.equal(bumpFor('chore(ci): tracer l arborescence du site'), 'patch');
    assert.equal(bumpFor('docs: mettre a jour le CLAUDE.md'), 'patch');
    assert.equal(bumpFor('test(gantt): borner le calage sur la sur-colonne'), 'patch');
});

test('bumpFor detecte la rupture signalee par le point d exclamation', () => {
    assert.equal(bumpFor('feat(api)!: renommer le champ statut'), 'major');
    assert.equal(bumpFor('refactor!: supprimer le bridge historique'), 'major');
});

test('bumpFor detecte la rupture declaree en footer', () => {
    const message = 'feat(bridge): nouvelle negociation\n\nBREAKING CHANGE: le handshake v1 disparait';
    assert.equal(bumpFor(message), 'major');
    assert.equal(bumpFor('fix: purge\n\nBREAKING-CHANGE: les anciennes cles sautent'), 'major');
});

test('bumpFor ignore une mention de rupture dans le sujet', () => {
    assert.equal(bumpFor('docs: documenter les BREAKING CHANGE a venir'), 'patch');
});

test('bumpFor retombe sur patch pour un commit hors convention', () => {
    assert.equal(bumpFor('Merge branch main into feature'), 'patch');
    assert.equal(bumpFor('correction rapide du calendrier'), 'patch');
    assert.equal(bumpFor(''), 'patch');
});

test('highestBump retient le bump le plus fort du lot', () => {
    assert.equal(highestBump(['fix: a', 'feat: b', 'chore: c']), 'minor');
    assert.equal(highestBump(['fix: a', 'feat!: b', 'feat: c']), 'major');
    assert.equal(highestBump(['chore: a']), 'patch');
    assert.equal(highestBump([]), null);
});

test('nextVersion remet a zero les rangs inferieurs', () => {
    assert.deepEqual(nextVersion('1.4.7', ['feat: x']), { version: '1.5.0', bump: 'minor' });
    assert.deepEqual(nextVersion('1.4.7', ['feat!: x']), { version: '2.0.0', bump: 'major' });
    assert.deepEqual(nextVersion('1.4.7', ['fix: x']), { version: '1.4.8', bump: 'patch' });
});

test('nextVersion accepte le prefixe v et laisse la version intacte sans commit', () => {
    assert.equal(nextVersion('v1.1.2', ['feat: x']).version, '1.2.0');
    assert.deepEqual(nextVersion('1.1.2', []), { version: '1.1.2', bump: 'none' });
});

test('nextVersion refuse une version de depart invalide', () => {
    assert.throws(() => nextVersion('1.2', ['fix: x']), /Version de depart invalide/);
    assert.throws(() => nextVersion('1.02.0', ['fix: x']), /Version de depart invalide/);
});

test('latestStable compare les rangs numeriquement et non lexicalement', () => {
    assert.equal(latestStable(['v1.9.0', 'v1.10.0', 'v1.2.0']), '1.10.0');
    assert.equal(latestStable(['v2.0.0', 'v10.0.0']), '10.0.0');
});

test('latestStable ignore les pre-releases et les tags par widget', () => {
    assert.equal(latestStable(['v1.2.0', 'v1.3.0-rc.1', 'v1.3.0-beta']), '1.2.0');
    assert.equal(latestStable(['taskflow-v1.1.2', 'atlas-v1.0.2']), null);
    assert.equal(latestStable(['v1.2.0+build.5']), null);
});

test('latestStable rend null quand aucun tag ne correspond', () => {
    assert.equal(latestStable([]), null);
    assert.equal(latestStable(['pas-un-tag']), null);
});
