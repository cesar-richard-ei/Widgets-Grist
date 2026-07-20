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

test('buildStatusConfig tient le dernier statut pour terminal', () => {
    const cfg = TF.buildStatusConfig([{ value: 'a' }, { value: 'b' }, { value: 'c' }], 'choice');
    assert.equal(cfg.terminalValue, 'c');
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
