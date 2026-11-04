'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commitsDOrigine, commentaire } = require('../../scripts/prs-livrees.js');

const SHA_A = 'fd3779f0e1c2b3a4d5e6f708192a3b4c5d6e7f80';
const SHA_B = '1d6cd99a1b2c3d4e5f60718293a4b5c6d7e8f901';

test('commitsDOrigine lit la ligne laissee par cherry-pick -x', () => {
    const journal = [
        'fix(taskflow): une sous-tache suit le chantier de sa tache',
        '',
        'Choisir un parent impose son chantier.',
        '',
        `(cherry picked from commit ${SHA_A})`,
    ].join('\n');
    assert.deepEqual(commitsDOrigine(journal), [SHA_A]);
});

test('commitsDOrigine ignore les commits faits directement sur la branche', () => {
    assert.deepEqual(commitsDOrigine('ci: publier les releases depuis la branche release\n'), []);
});

test('commitsDOrigine ne garde chaque commit qu une fois, dans l ordre du journal', () => {
    const journal = [
        `(cherry picked from commit ${SHA_B})`,
        `(cherry picked from commit ${SHA_A})`,
        `(cherry picked from commit ${SHA_B})`,
    ].join('\n');
    assert.deepEqual(commitsDOrigine(journal), [SHA_B, SHA_A]);
});

test('commentaire reprend le message de la release', () => {
    assert.equal(
        commentaire('1.33.0'),
        'Livré dans la [version 1.33.0](https://github.com/cesar-richard-ei/Widgets-Grist/releases/tag/v1.33.0), en ligne sur https://cesar-richard-ei.github.io/Widgets-Grist/',
    );
});
