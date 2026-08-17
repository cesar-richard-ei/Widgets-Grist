'use strict';

// Documents Grist de référence pour les tests de bout en bout, et helpers d'ouverture.
//
// Un seul endroit décrit les colonnes et les données : sans cela chaque fichier recopie sa fixture,
// et une évolution de schéma demande de passer partout. Trois modèles coexistent dans la nature et
// doivent continuer de fonctionner, d'où trois constructeurs plutôt qu'un document unique.

const path = require('path');
const base = require('@playwright/test');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

const JOUR = 86400;
const AUJOURDHUI = Math.floor(Date.now() / 1000 / JOUR) * JOUR;

/** Horodatage Grist du jour courant décalé de n jours. */
const j = (n) => AUJOURDHUI + n * JOUR;

const COULEURS = { bleu: '#3e5de7', vert: '#10b981', ocre: '#f59e0b', rouge: '#ef4444', violet: '#8b5cf6' };

const COLONNES_TASKS = {
    titre: { type: 'Text' }, description: { type: 'Text' },
    dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' }, dateCloture: { type: 'Date' },
    priorite: { type: 'Choice' }, statut: { type: 'Choice' }, type: { type: 'Choice' },
    progression: { type: 'Numeric' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
    assignees: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' },
    dependDe: { type: 'RefList:Tasks' }, tags: { type: 'ChoiceList' },
    couleur: { type: 'Text' }, subtasks: { type: 'Text' }, charges: { type: 'Text' },
    projet: { type: 'Ref:Projects' }, parentTask: { type: 'Ref:Tasks' }
};

const COLONNES_CHANTIERS = {
    Nom_du_chantier: { type: 'Text' }, Description: { type: 'Text' },
    Date_debut: { type: 'Date' }, Date_fin: { type: 'Date' },
    Projets: { type: 'RefList:Projects' }, Contributeurs: { type: 'RefList:Team' }, Responsable: { type: 'Ref:Team' }
};

const EQUIPE = [
    { id: 1, nom: 'Alice Martin', role: 'Produit', actif: true, couleur: COULEURS.bleu },
    { id: 2, nom: 'Bruno Klein', role: 'Dev', actif: true, couleur: COULEURS.vert },
    { id: 3, nom: 'Chloe Roux', role: 'Design', actif: true, couleur: COULEURS.ocre },
    { id: 4, nom: 'David Sarr', role: 'Data', actif: true, couleur: COULEURS.rouge }
];

const PROJETS = [
    { id: 1, nom: 'Portail habilitations', couleur: COULEURS.bleu, actif: true, responsable: 2, Categorie: 1 },
    { id: 2, nom: 'Datalab', couleur: COULEURS.ocre, actif: true, responsable: 3, Categorie: 2 }
];

const CHANTIERS = [
    { id: 1, Nom_du_chantier: 'Socle technique', Date_debut: j(-20), Date_fin: j(40), Projets: ['L', 1], Responsable: 2 },
    { id: 2, Nom_du_chantier: 'Guides utilisateurs', Date_debut: j(-5), Date_fin: j(30), Projets: ['L', 2], Responsable: 3 }
];

// Une tâche par cas de figure utile : titre long, jalon, sous-tâche, équipe fournie, sans personne.
const TACHES = [
    { id: 1, titre: 'Cadrage des outils', dateDebut: j(-15), dateEcheance: j(10), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 1, 2, 3, 4], Responsable: 2, estimationH: 8, description: 'Comparer les offres', tags: ['L', 'poc'] },
    { id: 2, titre: 'Analyse Plateforme Applicative et Cartographie des Usages', dateDebut: j(0), dateEcheance: j(30), statut: 'inprogress', type: 'tache', priorite: '1', assignees: ['L', 1, 3], progression: 40 },
    { id: 3, titre: 'Recette', dateDebut: j(5), dateEcheance: j(45), statut: 'todo', type: 'tache', priorite: '3' },
    { id: 4, titre: 'Plateforme prête', dateDebut: j(35), dateEcheance: j(35), statut: 'todo', type: 'jalon', priorite: '1', Responsable: 4 },
    { id: 5, titre: 'Guide de prise en main', dateDebut: j(-2), dateEcheance: j(20), statut: 'todo', type: 'tache', priorite: '2', assignees: ['L', 3] }
];

const clone = (v) => JSON.parse(JSON.stringify(v));

function tableProjets() {
    // Le schéma complet attendu par le widget : une colonne manquante le ferait la créer à
    // l'ouverture, puis relire la table, ce qui fausse les mesures de lecture et ralentit les tests.
    return { columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, dateDebut: { type: 'Date' }, dateFin: { type: 'Date' }, responsable: { type: 'Ref:Team' }, actif: { type: 'Bool' }, Categorie: { type: 'Ref:Categorie_de_projet' } }, records: clone(PROJETS) };
}

function tableEquipe() {
    return { columns: { nom: { type: 'Text' }, email: { type: 'Text' }, avatar: { type: 'Text' }, role: { type: 'Choice' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } }, records: clone(EQUIPE) };
}

function tableCategories() {
    return { columns: { Categorie: { type: 'Text' } }, records: [{ id: 1, Categorie: 'Produit' }, { id: 2, Categorie: 'Projet' }] };
}

/**
 * Modèle cible : les chantiers ont leur table, une colonne de Tasks les référence.
 * `nomColonne` couvre les documents qui la nomment autrement, le lien se reconnaissant à son type.
 */
function documentCible(nomColonne) {
    const colonne = nomColonne || 'chantier';
    const colonnes = Object.assign({ [colonne]: { type: 'Ref:Chantiers' } }, clone(COLONNES_TASKS));
    const taches = clone(TACHES).map((t, i) => Object.assign(t, { [colonne]: i === 4 ? 2 : 1 }));
    // Une sous-tâche, pour exercer la hiérarchie sous un chantier.
    taches.push({ id: 6, titre: 'Atelier de cadrage', [colonne]: 1, parentTask: 1, dateDebut: j(-12), dateEcheance: j(-4), statut: 'done', type: 'tache', priorite: '3' });
    return {
        Projects: tableProjets(), Team: tableEquipe(), Categorie_de_projet: tableCategories(),
        Chantiers: { columns: clone(COLONNES_CHANTIERS), records: clone(CHANTIERS) },
        Tasks: { columns: colonnes, records: taches }
    };
}

/** Copie de travail rencontrée chez le métier : parentTask pointe vers Chantiers, sans colonne dédiée. */
function documentParentRepointe() {
    const colonnes = Object.assign({}, clone(COLONNES_TASKS), { parentTask: { type: 'Ref:Chantiers' } });
    const taches = clone(TACHES).map((t, i) => Object.assign(t, { parentTask: i === 4 ? 2 : 1 }));
    return {
        Projects: tableProjets(), Team: tableEquipe(), Categorie_de_projet: tableCategories(),
        Chantiers: { columns: clone(COLONNES_CHANTIERS), records: clone(CHANTIERS) },
        Tasks: { columns: colonnes, records: taches }
    };
}

/** Ancien modèle : pas de table Chantiers, la hiérarchie vit entre tâches. */
function documentSansChantiers() {
    const taches = clone(TACHES);
    taches.forEach((t) => { t.projet = t.id === 5 ? 2 : 1; });
    taches.push({ id: 6, titre: 'Atelier de cadrage', parentTask: 1, projet: 1, dateDebut: j(-12), dateEcheance: j(-4), statut: 'done', type: 'tache', priorite: '3' });
    return {
        Projects: tableProjets(), Team: tableEquipe(), Categorie_de_projet: tableCategories(),
        Tasks: { columns: clone(COLONNES_TASKS), records: taches }
    };
}

/** Retire une colonne de Tasks, pour les fonctionnalités qui doivent disparaître avec elle. */
function sansColonne(doc, colonne) {
    const copie = clone(doc);
    delete copie.Tasks.columns[colonne];
    copie.Tasks.records.forEach((r) => delete r[colonne]);
    return copie;
}

/**
 * Passe une colonne en calculée : elle reste lisible et refuse l'écriture, comme dans Grist. Le
 * métier remonte volontiers en formule une colonne qu'il veut déduire, et le widget doit continuer
 * d'écrire le reste plutôt que de perdre le lot entier.
 */
function colonneCalculee(doc, table, colonne) {
    const copie = clone(doc);
    copie[table].columns[colonne].isFormula = true;
    return copie;
}

/**
 * Ouvre un widget sur un document donné.
 * options : { theme, largeur, hauteur, reglages, refuser, optionsSection, attendre }
 */
async function ouvrir(page, widget, doc, options) {
    const o = options || {};
    if (o.theme) await page.emulateMedia({ colorScheme: o.theme });
    if (o.largeur) await page.setViewportSize({ width: o.largeur, height: o.hauteur || 720 });
    // La vraie API Grist écraserait le simulacre.
    await page.route('**/grist-plugin-api.js', (route) => route.abort());
    await page.addInitScript({ path: CHEMIN_SIMULACRE });
    await page.addInitScript(([document, reglages, refusee, optionsSection]) => {
        window.grist = window.createFakeGrist(document, optionsSection ? { options: optionsSection } : undefined);
        if (refusee) {
            const vraie = window.grist.docApi.fetchTable.bind(window.grist.docApi);
            window.grist.docApi.fetchTable = (nom) => nom === refusee ? Promise.reject(new Error('Access denied')) : vraie(nom);
        }
        // Un seul appel à ouvrir() par test : le stockage n'est préparé qu'à la première
        // navigation, un second appel avec d'autres réglages ne les poserait pas.
        // Le script d'initialisation est rejoué à chaque navigation, rechargement compris : sans
        // ce garde, un test qui recharge la page pour vérifier une persistance effacerait d'abord
        // ce qu'il cherche à retrouver. Le sessionStorage survit au rechargement, pas au contexte.
        try {
            if (!sessionStorage.getItem('__preparation')) {
                localStorage.clear();
                for (const [cle, valeur] of Object.entries(reglages || {})) localStorage.setItem(cle, valeur);
                sessionStorage.setItem('__preparation', '1');
            }
        } catch (e) { /* stockage indisponible */ }
    }, [doc || documentCible(), o.reglages || {}, o.refuser || null, o.optionsSection || null]);
    await page.goto('http://localhost:3001/tasks_app/' + widget + '.html');
    if (o.attendre !== false) await page.waitForSelector(o.attendre || '#taskList .task-row');
}

const ouvrirGantt = (page, doc, options) => ouvrir(page, 'gantt', doc, options);
const ouvrirPlan = (page, doc, options) => ouvrir(page, 'plan', doc, Object.assign({ attendre: '.plan-grid, #grid' }, options || {}));

/** Ligne de la colonne de gauche portant ce libellé. */
const ligne = (page, titre) => page.locator('#taskList .task-row', { hasText: titre });

/** Déplie une ligne parente et attend qu'une de ses filles paraisse. */
async function deplier(page, parent, fille) {
    await ligne(page, parent).locator('.tree-chevron').click();
    await ligne(page, fille).waitFor();
}

/**
 * Déplie toutes les branches repliées, jusqu'à ce qu'il n'en reste aucune : les lignes filles ne
 * sont pas rendues tant que leur parent est fermé, et un test qui les cherche ne trouve rien.
 */
async function toutDeplier(page) {
    // Chaque dépliage reconstruit la liste : on re-résout le premier chevron fermé **visible** à
    // chaque tour, plutôt que de parcourir une collection que le rendu vient de remplacer. Un
    // chevron qui refuse le clic termine la boucle au lieu de la faire attendre son délai.
    for (let tour = 0; tour < 20; tour++) {
        const ferme = page.locator('#taskList .task-row .tree-chevron:not(.expanded):visible').first();
        if (!(await ferme.count())) return;
        try {
            await ferme.click({ timeout: 2000 });
        } catch (e) {
            return;
        }
        await page.locator('#taskList .task-row').first().waitFor();
    }
}

/**
 * Ouvre le volet sur une ligne, et attend la fin de sa transition d'ouverture. Le volet entre en
 * translateX : sa largeur vaut sa valeur finale dès la première image, c'est son bord gauche qui
 * se déplace. Surveiller la largeur rendrait donc la main sur un volet encore en mouvement, dont
 * la poignée n'est pas à sa place.
 */
async function ouvrirVolet(page, titre) {
    await ligne(page, titre).click();
    await base.expect(page.locator('#panel')).toHaveClass(/open/);
    const bord = () => page.locator('#panel').evaluate((el) => el.getBoundingClientRect().x);
    let precedent = -1;
    for (let i = 0; i < 20; i++) {
        const actuel = await bord();
        if (Math.abs(actuel - precedent) < 0.5) return;
        precedent = actuel;
        await page.waitForTimeout(50);
    }
}

/**
 * Attend le rendu reporté : un render() demandé pendant un geste souris est mis de côté et rejoué
 * au relâchement, un tour de boucle plus tard. Lire le DOM sans cette attente rend l'état d'avant
 * le geste.
 */
const attendreRendu = (page) => page.waitForFunction(() => !gesteSourisEnCours && !renduEnAttente);

/** Valeur d'une colonne de Tasks pour un enregistrement, lue dans le document. */
const champTache = (page, id, colonne) => page.evaluate(({ id, colonne }) => {
    return window.grist.docApi.fetchTable('Tasks').then((t) => t[colonne][t.id.indexOf(id)]);
}, { id, colonne });

/** Contraste WCAG entre la couleur du texte et son fond, pour un sélecteur donné. */
const contraste = (page, selecteur) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b); };
    const style = getComputedStyle(el);
    const a = lum(style.color), b = lum(style.backgroundColor);
    return { opaque: !/rgba\([^)]*,\s*0?(\.\d+)?\)/.test(style.backgroundColor), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
}, selecteur);

module.exports = {
    j, COULEURS, EQUIPE, PROJETS, CHANTIERS,
    documentCible, documentParentRepointe, documentSansChantiers, sansColonne, colonneCalculee,
    ouvrirGantt, ouvrirPlan, ligne, deplier, toutDeplier, ouvrirVolet, attendreRendu, champTache, contraste
};
