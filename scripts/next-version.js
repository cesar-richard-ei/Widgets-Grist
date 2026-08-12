/**
 * next-version.js
 *
 * Calcule le prochain tag SemVer a partir des commits accumules depuis le
 * dernier tag stable du depot.
 *
 * Regles appliquees (SemVer 2.0.0 + Conventional Commits) :
 *   - rupture (`type!:` ou footer `BREAKING CHANGE:`) -> MAJOR, minor et patch remis a zero
 *   - `feat` -> MINOR, patch remis a zero
 *   - tout le reste, y compris un commit hors convention -> PATCH
 * Le bump le plus fort du lot l'emporte.
 *
 * Usage: node scripts/next-version.js >> "$GITHUB_OUTPUT"
 * Sortie standard: `version=X.Y.Z` et `bump=major|minor|patch|none`
 */

'use strict';

const { execFileSync } = require('node:child_process');

// Base retenue tant qu'aucun tag `vX.Y.Z` n'existe : les tags historiques sont
// prefixes par widget (taskflow-v1.1.2) et ne servent pas de reference globale.
const BASE_INITIALE = '1.1.2';

const SEPARATEUR_COMMIT = '\x1e';
const ENTETE_CONVENTIONNELLE = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s+\S/;
const FOOTER_RUPTURE = /^BREAKING[ -]CHANGE:\s/m;
const VERSION_STABLE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const POIDS = { patch: 1, minor: 2, major: 3 };

function parseVersion(valeur) {
    const trouve = VERSION_STABLE.exec(String(valeur).trim());
    if (!trouve) return null;
    return { major: Number(trouve[1]), minor: Number(trouve[2]), patch: Number(trouve[3]) };
}

function compareVersions(a, b) {
    return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Retient le tag stable de plus haute precedence. Les pre-releases sont
 * ignorees : SemVer leur donne une precedence inferieure a la version associee.
 */
function latestStable(tags) {
    let meilleur = null;
    for (const tag of tags) {
        const version = parseVersion(tag);
        if (!version) continue;
        if (!meilleur || compareVersions(version, meilleur) > 0) meilleur = version;
    }
    return meilleur ? formatVersion(meilleur) : null;
}

/**
 * @returns {{type: string, scope: string|null, rupture: boolean}|null}
 */
function parseHeader(message) {
    const entete = String(message).trim().split('\n', 1)[0];
    const trouve = ENTETE_CONVENTIONNELLE.exec(entete);
    if (!trouve) return null;
    return { type: trouve[1].toLowerCase(), scope: trouve[2] || null, rupture: Boolean(trouve[3]) };
}

function bumpFor(message) {
    const texte = String(message).trim();
    if (!texte) return 'patch';

    const entete = texte.split('\n', 1)[0];
    const corps = texte.slice(entete.length);
    const trouve = parseHeader(entete);

    if (trouve && trouve.rupture) return 'major';
    if (FOOTER_RUPTURE.test(corps)) return 'major';
    if (trouve && trouve.type === 'feat') return 'minor';
    return 'patch';
}

function highestBump(messages) {
    let retenu = null;
    for (const message of messages) {
        const bump = bumpFor(message);
        if (!retenu || POIDS[bump] > POIDS[retenu]) retenu = bump;
    }
    return retenu;
}

function formatVersion({ major, minor, patch }) {
    return `${major}.${minor}.${patch}`;
}

function applyBump(version, bump) {
    if (bump === 'major') return { major: version.major + 1, minor: 0, patch: 0 };
    if (bump === 'minor') return { major: version.major, minor: version.minor + 1, patch: 0 };
    return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

/**
 * @param {string} base version de depart, avec ou sans le prefixe `v`
 * @param {string[]} messages messages complets des commits a prendre en compte
 * @returns {{version: string, bump: string}}
 */
function nextVersion(base, messages) {
    const depart = parseVersion(base);
    if (!depart) throw new Error(`Version de depart invalide : ${base}`);

    const bump = highestBump(messages);
    if (!bump) return { version: formatVersion(depart), bump: 'none' };

    return { version: formatVersion(applyBump(depart, bump)), bump };
}

function git(...args) {
    return execFileSync('git', args, { encoding: 'utf8' });
}

function main() {
    const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
    const dernier = latestStable(tags);
    const base = dernier || BASE_INITIALE;

    const dejaTague = latestStable(git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean));
    if (dejaTague) {
        process.stderr.write(`HEAD porte deja le tag v${dejaTague}\n`);
        process.stdout.write(`version=${dejaTague}\nbump=none\n`);
        return;
    }

    const plage = dernier ? [`v${dernier}..HEAD`] : [];
    const journal = git('log', '--no-merges', `--format=%B${SEPARATEUR_COMMIT}`, ...plage);
    const messages = journal.split(SEPARATEUR_COMMIT).map((m) => m.trim()).filter(Boolean);

    const { version, bump } = nextVersion(base, messages);
    process.stderr.write(`Base ${base}${dernier ? '' : ' (aucun tag vX.Y.Z)'}, ${messages.length} commit(s), bump ${bump}\n`);
    process.stdout.write(`version=${version}\nbump=${bump}\n`);
}

if (require.main === module) main();

module.exports = { parseVersion, compareVersions, latestStable, parseHeader, bumpFor, highestBump, nextVersion };
