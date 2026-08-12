#!/usr/bin/env node
/*
 * build-inline.js — Inline des fichiers JavaScript dans les widgets HTML.
 *
 * Architecture : source DRY, livrable autonome.
 *   - Le code vit dans des fichiers .js, editables et analysables par ESLint.
 *   - Chaque widget reste un fichier HTML autonome (collable dans le custom widget
 *     builder de Grist, resilient). Les sources sont INLINE entre deux marqueurs :
 *
 *       // <inline:core/taskflow-core.js>
 *       ... contenu genere, ne pas editer a la main ...
 *       // </inline>
 *
 * Le chemin est relatif au dossier du widget. Un fichier peut porter plusieurs
 * blocs. Le contenu est reindente sur le marqueur d'ouverture. Idempotent.
 *
 * Usage : node scripts/build-inline.js [--check]
 *   --check : ne reecrit rien, sort en code 1 si un widget est desynchronise (CI).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROJECTS = path.join(ROOT, 'projects');

const OUVERTURE = /^\/\/ <inline:([^>\s]+)>/;
const FERMETURE = '// </inline>';
const AVERTISSEMENT = ' -- GENERE par scripts/build-inline.js, NE PAS EDITER ICI';

function listerWidgets(dir) {
    const trouves = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const complet = path.join(dir, entry.name);
        if (entry.isDirectory()) trouves.push(...listerWidgets(complet));
        else if (entry.name.endsWith('.html')) trouves.push(complet);
    }
    return trouves;
}

function lireSource(sourcePath) {
    return fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

function construire(filePath, check) {
    const nom = path.relative(ROOT, filePath);
    const original = fs.readFileSync(filePath, 'utf8');
    const eol = original.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
    const lignes = original.replace(/\r\n/g, '\n').split('\n');

    const sortie = [];
    let blocs = 0;

    for (let i = 0; i < lignes.length; i++) {
        // Un marqueur n'est reconnu que seul sur sa ligne : aucune collision possible
        // avec une occurrence du texte a l'interieur d'une source inlinee.
        const trouve = OUVERTURE.exec(lignes[i].trim());
        if (!trouve) {
            sortie.push(lignes[i]);
            continue;
        }

        const indent = (lignes[i].match(/^[ \t]*/) || [''])[0];
        const source = path.resolve(path.dirname(filePath), trouve[1]);
        if (!fs.existsSync(source)) {
            console.error(`ERREUR (source introuvable ${trouve[1]}): ${nom}`);
            return { erreur: true };
        }

        let fin = -1;
        for (let j = i + 1; j < lignes.length; j++) {
            if (lignes[j].trim().indexOf(FERMETURE) === 0) { fin = j; break; }
        }
        if (fin === -1) {
            console.error(`ERREUR (marqueur fermant absent apres ${trouve[1]}): ${nom}`);
            return { erreur: true };
        }

        sortie.push(`${indent}// <inline:${trouve[1]}>${AVERTISSEMENT}`);
        for (const ligne of lireSource(source).split('\n')) sortie.push(ligne.length ? indent + ligne : ligne);
        sortie.push(indent + FERMETURE);

        blocs += 1;
        i = fin;
    }

    if (blocs === 0) return { ignore: true };

    const suivant = sortie.join(eol);
    if (suivant === original) {
        console.log(`OK (a jour): ${nom}`);
        return {};
    }
    if (check) {
        console.error(`DESYNC: ${nom} (lancer: npm run build:inline)`);
        return { desync: true };
    }
    fs.writeFileSync(filePath, suivant, 'utf8');
    console.log(`MAJ: ${nom}`);
    return {};
}

function main() {
    const check = process.argv.includes('--check');
    let desync = false, erreur = false, traites = 0;

    for (const widget of listerWidgets(PROJECTS)) {
        const r = construire(widget, check);
        if (r.ignore) continue;
        traites += 1;
        if (r.desync) desync = true;
        if (r.erreur) erreur = true;
    }

    if (traites === 0) {
        console.error('ERREUR: aucun marqueur <inline:...> trouve');
        process.exit(1);
    }
    if (erreur) process.exit(1);
    if (check && desync) process.exit(1);
}

main();
