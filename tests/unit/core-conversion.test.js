'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TF = require('../../projects/tasks_app/core/taskflow-core.js');

test('columnarToRows convertit le format colonnaire en lignes', () => {
    const rows = TF.columnarToRows({ id: [1, 2], titre: ['A', 'B'] });
    assert.deepEqual(rows, [{ id: 1, titre: 'A' }, { id: 2, titre: 'B' }]);
});

test('columnarToRows laisse passer un tableau deja converti', () => {
    const input = [{ id: 1 }];
    assert.equal(TF.columnarToRows(input), input);
});

test('columnarToRows rend un tableau vide sur entree vide ou absente', () => {
    assert.deepEqual(TF.columnarToRows(null), []);
    assert.deepEqual(TF.columnarToRows({}), []);
});

test('buildStatusConfig retombe sur les statuts par defaut si la liste est vide', () => {
    const cfg = TF.buildStatusConfig([], 'choice');
    assert.equal(cfg.source, 'default');
    assert.deepEqual(cfg.values, ['todo', 'inprogress', 'review', 'done']);
    assert.equal(cfg.terminalValue, 'done');
    assert.equal(cfg.firstValue, 'todo');
});

test('buildStatusConfig complete le libelle et la couleur des codes connus', () => {
    const cfg = TF.buildStatusConfig([{ value: 'todo' }], 'choice');
    assert.equal(cfg.source, 'choice');
    assert.equal(cfg.byValue.todo.label, 'À faire');
    assert.equal(cfg.byValue.todo.fillColor, '#94a3b8');
});

test('buildStatusConfig respecte un libelle explicite', () => {
    const cfg = TF.buildStatusConfig([{ value: 'todo', label: 'A traiter' }], 'choice');
    assert.equal(cfg.byValue.todo.label, 'A traiter');
});

// Le document du metier declare ses statuts dans l'ordre de son choix, et en ajoute apres la
// cloture : « todo, inprogress, review, done, Pre-cadrage, Cadrage, En attente externe ». Tenir le
// dernier pour terminal y designe « En attente externe » et laisse « done » ouvert.
test('buildStatusConfig reconnait les statuts de cloture, ou qu ils soient dans la liste', () => {
    const cfg = TF.buildStatusConfig(
        [{ value: 'todo' }, { value: 'inprogress' }, { value: 'review' }, { value: 'done' },
         { value: 'Pre-cadrage' }, { value: 'Cadrage' }, { value: 'En attente externe' }], 'choice');
    assert.equal(cfg.terminalValue, 'done');
    assert.deepEqual(cfg.terminalValues, ['done']);
    assert.equal(cfg.firstValue, 'todo');
    assert.equal(TF.isTerminal(cfg, 'done'), true);
    assert.equal(TF.isTerminal(cfg, 'En attente externe'), false);
});

test('buildStatusConfig retient plusieurs statuts de cloture', () => {
    const cfg = TF.buildStatusConfig(
        [{ value: 'todo' }, { value: 'Termine' }, { value: 'Annule' }, { value: 'inprogress' }], 'choice');
    assert.deepEqual(cfg.terminalValues, ['Termine', 'Annule']);
    assert.equal(cfg.terminalValue, 'Termine');
    assert.equal(TF.isTerminal(cfg, 'Annule'), true);
    assert.equal(TF.isTerminal(cfg, 'inprogress'), false);
});

// Sans aucune valeur reconnue, mieux vaut la convention historique que pas de cloture du tout.
test('buildStatusConfig retombe sur le dernier statut quand aucun n est reconnu', () => {
    const cfg = TF.buildStatusConfig([{ value: 'a' }, { value: 'b' }, { value: 'c' }], 'choice');
    assert.equal(cfg.terminalValue, 'c');
    assert.deepEqual(cfg.terminalValues, ['c']);
    assert.equal(cfg.firstValue, 'a');
});

test('getStatus rend un statut neutre pour une valeur inconnue', () => {
    const cfg = TF.buildStatusConfig([{ value: 'todo' }], 'choice');
    assert.deepEqual(TF.getStatus(cfg, 'inexistant'), {
        value: 'inexistant', label: 'inexistant', fillColor: '#94a3b8', textColor: '#ffffff'
    });
});

test('isTerminal ne reconnait que le dernier statut', () => {
    const cfg = TF.buildStatusConfig([{ value: 'a' }, { value: 'b' }], 'choice');
    assert.equal(TF.isTerminal(cfg, 'b'), true);
    assert.equal(TF.isTerminal(cfg, 'a'), false);
    assert.equal(TF.isTerminal(null, 'b'), false);
});
