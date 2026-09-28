/**
 * build-site.js
 *
 * Construit le site servi par GitHub Pages depuis projects/, selon site.json, et génère le
 * manifest.json du catalogue de widgets Grist.
 *
 * Usage: node scripts/build-site.js [destination]    (défaut : site/)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');

function lireConfig(racine) {
    return JSON.parse(fs.readFileSync(path.join(racine, 'site.json'), 'utf8'));
}

// Date du dernier commit touchant les sources d'un dossier : le manifest reste identique d'une
// génération à l'autre, et le champ dit ce qu'il annonce plutôt que l'heure du build.
function derniereModification(racine, sources) {
    try {
        const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', ...sources], {
            encoding: 'utf8', cwd: racine, stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        return iso || null;
    } catch (err) {
        return null;
    }
}

function widgetsDuCatalogue(nom, catalogue, baseUrl, majLe) {
    const configs = Array.isArray(catalogue.grist) ? catalogue.grist : [catalogue.grist];
    return configs.map((config) => {
        let url;
        if (config.url && config.url.startsWith('http')) url = config.url;
        else url = `${baseUrl}/${nom}/${config.url || ''}`;
        return {
            widgetId: config.widgetId || catalogue.name,
            name: config.name || catalogue.name,
            url: url,
            published: true,
            accessLevel: config.accessLevel || 'none',
            renderAfterReady: config.renderAfterReady !== false,
            description: config.description || catalogue.description || '',
            ...(majLe && { lastUpdatedAt: majLe }),
            ...(config.authors && { authors: config.authors }),
            ...(catalogue.authors && !config.authors && { authors: catalogue.authors })
        };
    });
}

function construire({ racine = RACINE, destination, baseUrl }) {
    const config = lireConfig(racine);
    const manquants = [];
    const widgets = [];

    for (const [nom, dossier] of Object.entries(config)) {
        const sources = Object.values(dossier.fichiers).concat(dossier.catalogue ? [dossier.catalogue] : []);
        manquants.push(...sources.filter((s) => !fs.existsSync(path.join(racine, s))));
        if (manquants.length) continue;

        for (const [cible, source] of Object.entries(dossier.fichiers)) {
            const chemin = path.join(destination, nom, cible);
            fs.mkdirSync(path.dirname(chemin), { recursive: true });
            fs.copyFileSync(path.join(racine, source), chemin);
        }
        if (dossier.catalogue) {
            const catalogue = JSON.parse(fs.readFileSync(path.join(racine, dossier.catalogue), 'utf8'));
            widgets.push(...widgetsDuCatalogue(nom, catalogue, baseUrl, derniereModification(racine, sources)));
        }
    }

    if (manquants.length) throw new Error('Sources absentes de site.json : ' + manquants.join(', '));

    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(widgets, null, 2));
    return widgets;
}

if (require.main === module) {
    const utilisateur = process.env.GITHUB_USER || 'VOTRE_USER';
    const depot = process.env.REPO_NAME || 'Widgets-Grist';
    // BASE_URL permet de publier le même contenu sous un sous-chemin (ex. /dev)
    const baseUrl = (process.env.BASE_URL || `https://${utilisateur}.github.io/${depot}`).replace(/\/+$/, '');
    const destination = path.resolve(process.argv[2] || path.join(RACINE, 'site'));
    try {
        const widgets = construire({ destination, baseUrl });
        console.log(`Site construit dans ${destination}, ${widgets.length} widgets au catalogue`);
        console.log(`GRIST_WIDGET_LIST_URL=${baseUrl}/manifest.json`);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}

module.exports = { construire };
