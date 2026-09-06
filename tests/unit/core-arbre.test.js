'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/arbre.js');

// La hiérarchie des tâches, partagée par les widgets qui l'affichent en arbre.

const arbre = (taches) => TF.construireArbre(taches);

test('les enfants se rangent sous leur parent', () => {
    const a = arbre([{ id: 1 }, { id: 2, parentTask: 1 }, { id: 3, parentTask: 1 }, { id: 4 }]);
    assert.deepEqual(a.enfants(1).map((t) => t.id), [2, 3]);
    assert.deepEqual(a.enfants(4), []);
    assert.equal(a.aDesEnfants({ id: 1 }), true);
    assert.equal(a.aDesEnfants({ id: 4 }), false);
});

test('les descendants suivent toute la branche', () => {
    const a = arbre([{ id: 1 }, { id: 2, parentTask: 1 }, { id: 3, parentTask: 2 }]);
    assert.deepEqual(a.descendants(1).map((t) => t.id), [2, 3]);
    assert.equal(a.profondeur({ id: 3, parentTask: 2 }), 2);
});

// Les identifiants de Tasks et de Chantiers se recouvrent sur le document du métier : un parent
// repointé y forme des chaînes circulaires, qui ne doivent ni boucler ni faire disparaître la ligne.
test('une chaine circulaire est ecartee du rattachement', () => {
    const a = arbre([{ id: 1, parentTask: 2 }, { id: 2, parentTask: 1 }, { id: 3 }]);
    assert.deepEqual([...a.cycles].sort(), [1, 2]);
    assert.deepEqual(a.enfants(1), []);
    assert.deepEqual(a.enfants(2), []);
});

test('une tache ne peut pas devenir sa propre descendante', () => {
    const a = arbre([{ id: 1 }, { id: 2, parentTask: 1 }, { id: 3, parentTask: 2 }]);
    assert.equal(a.peutAvoirPourParent(1, 3), false);
    assert.equal(a.peutAvoirPourParent(1, 1), false);
    assert.equal(a.peutAvoirPourParent(3, null), true);
    assert.equal(a.peutAvoirPourParent(2, 3), false);
});

test('la progression d un parent est la moyenne de ses enfants', () => {
    const a = arbre([{ id: 1 }, { id: 2, parentTask: 1, progression: 50 }, { id: 3, parentTask: 1, progression: 100 }]);
    assert.equal(a.progression({ id: 1 }), 75);
});

test('la progression se pondere par l estimation quand tous les enfants en portent une', () => {
    const a = arbre([
        { id: 1 },
        { id: 2, parentTask: 1, progression: 100, estimationH: 30 },
        { id: 3, parentTask: 1, progression: 0, estimationH: 10 }
    ]);
    assert.equal(a.progression({ id: 1 }), 75);
});

test('la progression d une feuille est la sienne', () => {
    const a = arbre([{ id: 1, progression: 42 }]);
    assert.equal(a.progression({ id: 1, progression: 42 }), 42);
});

// Un parent peut réserver une plage plus large que ses enfants : ses dates propres l'emportent.
test('les bornes d un parent englobent celles de ses enfants', () => {
    const a = arbre([
        { id: 1, dateDebut: 300, dateEcheance: 400 },
        { id: 2, parentTask: 1, dateDebut: 100, dateEcheance: 200 },
        { id: 3, parentTask: 1, dateDebut: 500, dateEcheance: 600 }
    ]);
    assert.deepEqual(a.bornes({ id: 1, dateDebut: 300, dateEcheance: 400 }), { start: 100, end: 600 });
});

test('le parcours suit l ordre d affichage, parent puis enfants', () => {
    const taches = [{ id: 1 }, { id: 2, parentTask: 1 }, { id: 3, parentTask: 2 }, { id: 4, parentTask: 1 }, { id: 5 }];
    const a = arbre(taches);
    const vus = [];
    a.parcourir([taches[0], taches[4]], (t, profondeur) => vus.push(t.id + ':' + profondeur));
    assert.deepEqual(vus, ['1:0', '2:1', '3:2', '4:1', '5:0']);
});

test('un arbre vide ne casse pas', () => {
    const a = arbre(null);
    assert.deepEqual(a.enfants(1), []);
    assert.deepEqual(a.descendants(1), []);
    assert.equal(a.parent({ id: 1, parentTask: 9 }), null);
});
