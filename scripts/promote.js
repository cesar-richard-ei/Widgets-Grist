/**
 * promote.js
 *
 * Copie un widget depuis la zone de développement vers published/
 *
 * Usage: node scripts/promote.js <source> <target>
 * Exemple: node scripts/promote.js tasks_app/kanban.html taskflow/kanban
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

if (args.length < 2) {
    console.log(`
Usage: node scripts/promote.js <source> <target>

Arguments:
  source  Chemin relatif vers le fichier/dossier source
  target  Chemin de destination dans published/ (sans 'published/')

Exemples:
  # Promouvoir un fichier HTML
  node scripts/promote.js tasks_app/kanban.html taskflow/kanban

  # Promouvoir un dossier entier
  node scripts/promote.js widget_app/templates artefactory/templates

Options:
  --dry-run   Afficher ce qui serait fait sans l'exécuter
`);
    process.exit(1);
}

const [source, target] = args;
const dryRun = args.includes('--dry-run');

const sourcePath = path.join(__dirname, '..', source);
const targetPath = path.join(__dirname, '..', 'published', target);

if (!fs.existsSync(sourcePath)) {
    console.error(`Source non trouvée: ${sourcePath}`);
    process.exit(1);
}

const sourceStats = fs.statSync(sourcePath);

if (dryRun) {
    console.log('[DRY RUN] Actions prévues:');
}

if (sourceStats.isFile()) {
    // Promouvoir un fichier unique
    const finalPath = targetPath.endsWith('.html') ? targetPath : path.join(targetPath, 'index.html');
    const finalDir = path.dirname(finalPath);

    console.log(`Copie: ${source} -> published/${target}`);

    if (!dryRun) {
        fs.mkdirSync(finalDir, { recursive: true });
        fs.copyFileSync(sourcePath, finalPath);
        console.log(`Créé: ${finalPath}`);
    }

} else if (sourceStats.isDirectory()) {
    // Promouvoir un dossier entier
    console.log(`Copie dossier: ${source}/ -> published/${target}/`);

    if (!dryRun) {
        copyDirRecursive(sourcePath, targetPath);
        console.log(`Créé: ${targetPath}/`);
    }
}

// Rappel de créer package.json si nécessaire
const pkgPath = path.join(path.dirname(targetPath.endsWith('.html') ? targetPath : targetPath), 'package.json');
if (!fs.existsSync(pkgPath) && !dryRun) {
    console.log(`\nN'oubliez pas de créer un package.json pour le widget!`);
    console.log(`Chemin: ${pkgPath}`);
}

function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
