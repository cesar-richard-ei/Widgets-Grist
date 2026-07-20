'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/taskflow-core.js');

// Grist stocke les dates en secondes Unix.
const secondes = (annee, mois, jour) => Date.UTC(annee, mois, jour) / 1000;

test('parseCharges lit une repartition valide', () => {
    assert.deepEqual(
        TF.parseCharges('[{"teamId":1,"heures":5}]'),
        [{ teamId: 1, heures: 5 }]
    );
});

test('parseCharges convertit les valeurs textuelles en nombres', () => {
    assert.deepEqual(
        TF.parseCharges('[{"teamId":"2","heures":"3"}]'),
        [{ teamId: 2, heures: 3 }]
    );
});

test('parseCharges ecarte les entrees sans teamId', () => {
    assert.deepEqual(TF.parseCharges('[{"heures":5}]'), []);
});

test('parseCharges rend un tableau vide sur JSON invalide, absent ou non tableau', () => {
    assert.deepEqual(TF.parseCharges('pas du json'), []);
    assert.deepEqual(TF.parseCharges(null), []);
    assert.deepEqual(TF.parseCharges('{"teamId":1}'), []);
});

test('chargesToJson produit une forme relisible par parseCharges', () => {
    const json = TF.chargesToJson([{ teamId: '4', heures: '2' }]);
    assert.deepEqual(TF.parseCharges(json), [{ teamId: 4, heures: 2 }]);
});

test('chargeTotal somme les heures, depuis une chaine ou un tableau', () => {
    assert.equal(TF.chargeTotal('[{"teamId":1,"heures":5},{"teamId":2,"heures":3}]'), 8);
    assert.equal(TF.chargeTotal([{ teamId: 1, heures: 5 }]), 5);
    assert.equal(TF.chargeTotal(null), 0);
});

test('chargeByMember agrege les heures par personne sur plusieurs taches', () => {
    const taches = [
        { charges: '[{"teamId":1,"heures":4},{"teamId":2,"heures":2}]' },
        { charges: '[{"teamId":1,"heures":3}]' }
    ];
    assert.deepEqual(TF.chargeByMember(taches), { 1: 7, 2: 2 });
});

test('periodKey rend la semaine ISO', () => {
    // 2026-01-01 est un jeudi, donc en semaine 1.
    assert.equal(TF.periodKey(new Date(Date.UTC(2026, 0, 1)), 'week'), '2026-W01');
    // 2026-01-05 est le lundi de la semaine 2.
    assert.equal(TF.periodKey(new Date(Date.UTC(2026, 0, 5)), 'week'), '2026-W02');
});

test('periodKey rend le mois', () => {
    assert.equal(TF.periodKey(new Date(Date.UTC(2026, 6, 20)), 'month'), '2026-07');
});

test('periodRange aligne sur le lundi et enchaine les semaines', () => {
    // 2026-01-07 est un mercredi, la periode demarre au lundi 5.
    assert.deepEqual(
        TF.periodRange(new Date(Date.UTC(2026, 0, 7)), 'week', 3),
        ['2026-W02', '2026-W03', '2026-W04']
    );
});

test('periodRange aligne sur le premier du mois et franchit l annee', () => {
    assert.deepEqual(
        TF.periodRange(new Date(Date.UTC(2026, 10, 15)), 'month', 3),
        ['2026-11', '2026-12', '2027-01']
    );
});

test('shiftPeriods decale de semaines entieres', () => {
    const d = TF.shiftPeriods(new Date(Date.UTC(2026, 0, 5)), 'week', 2);
    assert.equal(d.toISOString().slice(0, 10), '2026-01-19');
});

test('chargeByMemberPeriod etale la charge sur la duree de la tache', () => {
    const taches = [{
        charges: '[{"teamId":1,"heures":10}]',
        dateDebut: secondes(2026, 0, 5),      // lundi
        dateEcheance: secondes(2026, 0, 9)    // vendredi, meme semaine ISO
    }];
    assert.deepEqual(TF.chargeByMemberPeriod(taches, 'week'), { 1: { '2026-W02': 10 } });
});

test('chargeByMemberPeriod ignore une tache sans dates ou sans charge', () => {
    assert.deepEqual(TF.chargeByMemberPeriod([{ charges: '[{"teamId":1,"heures":5}]' }], 'week'), {});
    assert.deepEqual(TF.chargeByMemberPeriod([{
        charges: '[]', dateDebut: secondes(2026, 0, 5), dateEcheance: secondes(2026, 0, 9)
    }], 'week'), {});
});

test('chargeMatrix regroupe selon la cle fournie', () => {
    const taches = [{
        projet: 7,
        charges: '[{"teamId":1,"heures":10}]',
        dateDebut: secondes(2026, 0, 5),
        dateEcheance: secondes(2026, 0, 9)
    }];
    const parProjet = TF.chargeMatrix(taches, (t) => t.projet, 'week');
    assert.deepEqual(parProjet, { 7: { '2026-W02': 10 } });
});

test('chargeMatrix en jours ouvres retombe sur le jour de debut si la periode n en contient aucun', () => {
    // Samedi a dimanche : aucun jour ouvre, la charge est portee par le jour de debut.
    const taches = [{
        charges: '[{"teamId":1,"heures":6}]',
        dateDebut: secondes(2026, 0, 10),
        dateEcheance: secondes(2026, 0, 11)
    }];
    const matrice = TF.chargeMatrix(taches, () => 'r', 'week', null, true);
    assert.deepEqual(matrice, { r: { '2026-W02': 6 } });
});
