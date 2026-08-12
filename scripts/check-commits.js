/**
 * check-commits.js
 *
 * Verifie que les messages de commit suivent Conventional Commits. La version
 * publiee est deduite de ces messages : un type mal orthographie passerait en
 * PATCH sans que personne ne le voie.
 *
 * Usage: node scripts/check-commits.js <plage git>
 * Exemple: node scripts/check-commits.js origin/main..HEAD
 */

'use strict';

const { execFileSync } = require('node:child_process');
const { parseHeader } = require('./next-version.js');

const TYPES = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];
const SEPARATEUR_COMMIT = '\x1e';
const REVERT_GIT = /^Revert "/;

function verifier(message) {
    const entete = String(message).trim().split('\n', 1)[0];
    if (REVERT_GIT.test(entete)) return null;

    const parsed = parseHeader(entete);
    if (!parsed) return 'entete hors convention, format attendu `type(portee): sujet`';
    if (!TYPES.includes(parsed.type)) return `type inconnu \`${parsed.type}\`, attendu ${TYPES.join(', ')}`;
    if (entete.length > 100) return `entete de ${entete.length} caracteres, 100 au maximum`;
    return null;
}

function main() {
    const plage = process.argv[2];
    if (!plage) {
        process.stderr.write('Usage: node scripts/check-commits.js <plage git>\n');
        process.exit(2);
    }

    const journal = execFileSync('git', ['log', '--no-merges', `--format=%H${SEPARATEUR_COMMIT}%B${SEPARATEUR_COMMIT}`, plage], { encoding: 'utf8' });
    const champs = journal.split(SEPARATEUR_COMMIT).map((c) => c.trim());

    const fautifs = [];
    let vus = 0;
    for (let i = 0; i + 1 < champs.length; i += 2) {
        const [sha, message] = [champs[i], champs[i + 1]];
        if (!sha) continue;
        vus += 1;
        const probleme = verifier(message);
        if (probleme) fautifs.push({ sha, entete: message.split('\n', 1)[0], probleme });
    }

    if (fautifs.length === 0) {
        process.stdout.write(`${vus} commit(s) conformes\n`);
        return;
    }

    for (const { sha, entete, probleme } of fautifs) {
        process.stderr.write(`${sha.slice(0, 8)} ${entete}\n  ${probleme}\n`);
    }
    process.exit(1);
}

if (require.main === module) main();

module.exports = { verifier, TYPES };
