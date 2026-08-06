/**
 * generate-manifest.js
 *
 * Génère le manifest.json pour le catalogue de widgets Grist
 * en scannant les package.json dans published/
 *
 * Usage: node scripts/generate-manifest.js
 */

const fs = require('fs');
const path = require('path');

// Configuration
const GITHUB_USER = process.env.GITHUB_USER || 'VOTRE_USER';
const REPO_NAME = process.env.REPO_NAME || 'Widgets-Grist';
// BASE_URL permet de publier le même contenu sous un sous-chemin (ex. /dev)
const BASE_URL = (process.env.BASE_URL || `https://${GITHUB_USER}.github.io/${REPO_NAME}`).replace(/\/+$/, '');
const PUBLISHED_DIR = path.join(__dirname, '..', 'published');
const OUTPUT_FILE = path.join(PUBLISHED_DIR, 'manifest.json');

console.log('Generating Grist widget manifest...');
console.log(`Base URL: ${BASE_URL}`);
console.log(`Scanning: ${PUBLISHED_DIR}`);

const widgets = [];

// Vérifier que le dossier published existe
if (!fs.existsSync(PUBLISHED_DIR)) {
    console.log('Creating published/ directory...');
    fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
}

// Scanner les sous-dossiers de published/
const entries = fs.readdirSync(PUBLISHED_DIR, { withFileTypes: true });

for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const widgetDir = path.join(PUBLISHED_DIR, entry.name);
    const packagePath = path.join(widgetDir, 'package.json');

    if (!fs.existsSync(packagePath)) {
        console.log(`  Skipping ${entry.name}/ (no package.json)`);
        continue;
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

        if (!pkg.grist) {
            console.log(`  Skipping ${entry.name}/ (no grist config)`);
            continue;
        }

        // Supporter à la fois un objet unique ou un tableau de widgets
        const gristConfigs = Array.isArray(pkg.grist) ? pkg.grist : [pkg.grist];

        for (const config of gristConfigs) {
            // Construire l'URL complète
            // Si config.url est relative (pas http), la préfixer avec BASE_URL/entry.name/
            let widgetUrl;
            if (config.url && config.url.startsWith('http')) {
                widgetUrl = config.url;
            } else if (config.url) {
                widgetUrl = `${BASE_URL}/${entry.name}/${config.url}`;
            } else {
                widgetUrl = `${BASE_URL}/${entry.name}/`;
            }

            const widget = {
                widgetId: config.widgetId || pkg.name,
                name: config.name || pkg.name,
                url: widgetUrl,
                published: true,
                accessLevel: config.accessLevel || 'none',
                renderAfterReady: config.renderAfterReady !== false,
                description: config.description || pkg.description || '',
                lastUpdatedAt: new Date().toISOString(),
                ...(config.authors && { authors: config.authors }),
                ...(pkg.authors && !config.authors && { authors: pkg.authors }),
            };

            widgets.push(widget);
            console.log(`  + ${widget.name} (${widget.widgetId})`);
        }
    } catch (err) {
        console.error(`  Error reading ${entry.name}/package.json:`, err.message);
    }
}

// Écrire le manifest
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(widgets, null, 2));
console.log(`\nGenerated ${OUTPUT_FILE}`);
console.log(`Total widgets: ${widgets.length}`);

// Afficher l'URL du manifest pour Grist
console.log(`\nPour configurer Grist, utilisez:`);
console.log(`GRIST_WIDGET_LIST_URL=${BASE_URL}/manifest.json`);
