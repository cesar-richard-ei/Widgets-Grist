/**
 * prs-livrees.js
 *
 * Une release part de la branche release, ou les commits arrivent par cherry-pick -x : semantic-release
 * ne reconnait donc pas les PR de main qui les ont apportes. Ce script les retrouve par la ligne
 * "cherry picked from commit" et leur pose le commentaire et le label que semantic-release pose aux autres.
 *
 * Usage: node scripts/prs-livrees.js <version>
 * Exemple: node scripts/prs-livrees.js 1.33.0
 */

'use strict';

const { execFileSync } = require('node:child_process');

const DEPOT = 'cesar-richard-ei/Widgets-Grist';
const LABEL = 'livré';
const CHERRY_PICK = /\(cherry picked from commit ([0-9a-f]{40})\)/g;

function commitsDOrigine(journal) {
    const vus = [];
    for (const trouve of String(journal).matchAll(CHERRY_PICK)) {
        if (!vus.includes(trouve[1])) vus.push(trouve[1]);
    }
    return vus;
}

// Même texte que le successComment de .releaserc.json.
function commentaire(version) {
    return `Livré dans la [version ${version}](https://github.com/${DEPOT}/releases/tag/v${version}), en ligne sur https://cesar-richard-ei.github.io/Widgets-Grist/`;
}

async function github(chemin, options = {}) {
    const reponse = await fetch(`https://api.github.com/repos/${DEPOT}${chemin}`, {
        ...options,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            'Content-Type': 'application/json',
        },
    });
    if (!reponse.ok) throw new Error(`${options.method || 'GET'} ${chemin} : ${reponse.status}`);
    return reponse.json();
}

async function main() {
    const version = process.argv[2];
    if (!version) {
        process.stderr.write('Usage: node scripts/prs-livrees.js <version>\n');
        process.exit(2);
    }
    const tag = `v${version}`;
    const precedent = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', `${tag}^`], { encoding: 'utf8' }).trim();
    const journal = execFileSync('git', ['log', '--format=%B', `${precedent}..${tag}`], { encoding: 'utf8' });

    const prs = new Map();
    for (const sha of commitsDOrigine(journal)) {
        for (const pr of await github(`/commits/${sha}/pulls`)) {
            if (pr.merged_at && pr.base.ref === 'main') prs.set(pr.number, pr);
        }
    }

    for (const pr of prs.values()) {
        if (pr.labels.some((l) => l.name === LABEL)) continue;
        await github(`/issues/${pr.number}/comments`, { method: 'POST', body: JSON.stringify({ body: commentaire(version) }) });
        await github(`/issues/${pr.number}/labels`, { method: 'POST', body: JSON.stringify({ labels: [LABEL] }) });
        process.stdout.write(`#${pr.number} ${pr.title}\n`);
    }
}

if (require.main === module) {
    main().catch((erreur) => {
        process.stderr.write(`${erreur.message}\n`);
        process.exit(1);
    });
}

module.exports = { commitsDOrigine, commentaire };
