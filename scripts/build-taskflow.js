#!/usr/bin/env node
/*
 * build-taskflow.js — Inline le module commun TaskFlow dans chaque widget.
 *
 * Architecture : source DRY, livrable autonome.
 *   - Source unique : projects/tasks_app/core/taskflow-core.js
 *   - Chaque widget reste un fichier HTML autonome (collable dans le custom widget
 *     builder de Grist, resilient). Le core est INLINE entre deux marqueurs :
 *
 *       // <taskflow-core>
 *       ... contenu genere, ne pas editer a la main ...
 *       // </taskflow-core>
 *
 * Le script remplace tout ce qui se trouve entre les marqueurs par le contenu du
 * core, en respectant l'indentation du marqueur d'ouverture. Idempotent.
 *
 * Un widget sans marqueurs est ignore (avertissement), jamais modifie.
 *
 * Usage : node scripts/build-taskflow.js [--check]
 *   --check : ne reecrit rien, sort en code 1 si un widget est desynchronise (CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE_PATH = path.join(ROOT, 'projects', 'tasks_app', 'core', 'taskflow-core.js');

// Widgets cibles. Le Whiteboard n'adopte qu'un sous-ensemble mais partage les memes
// marqueurs : le core est concu pour etre inerte si ses fonctions ne sont pas appelees.
const TARGETS = [
    path.join(ROOT, 'projects', 'tasks_app', 'kanban.html'),
    path.join(ROOT, 'projects', 'tasks_app', 'gantt.html'),
    path.join(ROOT, 'projects', 'tasks_app', 'calendar.html'),
    path.join(ROOT, 'projects', 'tasks_app', 'dashboard.html'),
    path.join(ROOT, 'projects', 'tasks_app', 'plan.html'),
    path.join(ROOT, 'projects', 'whiteboard', 'index.html')
];

const OPEN = '// <taskflow-core>';
const CLOSE = '// </taskflow-core>';

function readCore() {
    if (!fs.existsSync(CORE_PATH)) {
        console.error('ERREUR: core introuvable: ' + CORE_PATH);
        process.exit(1);
    }
    // On retire un eventuel shebang/commentaire d'en-tete propre au fichier source ?
    // Non : le core est ecrit pour etre inlinable tel quel. On le prend integralement.
    return fs.readFileSync(CORE_PATH, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function indentBlock(block, indent) {
    return block.split('\n').map(line => (line.length ? indent + line : line)).join('\n');
}

function buildFile(filePath, core, check) {
    const name = path.relative(ROOT, filePath);
    if (!fs.existsSync(filePath)) {
        console.warn('IGNORE (absent): ' + name);
        return { changed: false, skipped: true };
    }
    const original = fs.readFileSync(filePath, 'utf8');
    const eol = original.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    const lines = original.replace(/\r\n/g, '\n').split('\n');

    // Matching LIGNE PAR LIGNE : un marqueur n'est reconnu que s'il est SEUL sur sa
    // ligne (apres trim, la ligne COMMENCE par le marqueur). Cela evite toute
    // collision avec une occurrence du texte du marqueur a l'interieur du core.
    const isOpen = (l) => l.trim().indexOf(OPEN) === 0;
    const isClose = (l) => l.trim().indexOf(CLOSE) === 0;

    const openLine = lines.findIndex(isOpen);
    if (openLine === -1) {
        console.warn('IGNORE (pas de marqueurs ' + OPEN + '): ' + name);
        return { changed: false, skipped: true };
    }
    let closeLine = -1;
    for (let i = openLine + 1; i < lines.length; i++) { if (isClose(lines[i])) { closeLine = i; break; } }
    if (closeLine === -1) {
        console.error('ERREUR (marqueur fermant absent): ' + name);
        return { changed: false, error: true };
    }

    const indent = (lines[openLine].match(/^[ \t]*/) || [''])[0];
    const coreLines = core.split('\n').map(line => (line.length ? indent + line : line));

    const next = []
        .concat(lines.slice(0, openLine))
        .concat([indent + OPEN + ' -- GENERE par scripts/build-taskflow.js, NE PAS EDITER ICI'])
        .concat(coreLines)
        .concat([indent + CLOSE])
        .concat(lines.slice(closeLine + 1))
        .join(eol);

    if (next === original) {
        console.log('OK (a jour): ' + name);
        return { changed: false };
    }
    if (check) {
        console.error('DESYNC: ' + name + ' (lancer: npm run build:taskflow)');
        return { changed: true, desync: true };
    }
    fs.writeFileSync(filePath, next, 'utf8');
    console.log('MAJ: ' + name);
    return { changed: true };
}

function main() {
    const check = process.argv.includes('--check');
    const core = readCore();
    let desync = false, error = false;
    for (const f of TARGETS) {
        const r = buildFile(f, core, check);
        if (r.desync) desync = true;
        if (r.error) error = true;
    }
    if (error) process.exit(1);
    if (check && desync) process.exit(1);
}

main();
