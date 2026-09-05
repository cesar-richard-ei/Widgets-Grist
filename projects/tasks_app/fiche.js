'use strict';

// Fiche d'un projet : son cadrage, puis la feuille de route de ses chantiers.
// Le widget est lié à la table Projects et ne travaille que sur l'enregistrement sélectionné.
// Lecture seule : rien ne s'y crée, ne s'y modifie ni ne s'y supprime.

const CATEGORIE_FICHE = 'Projet';
const NOMS_DATE_CHANTIER = { debut: ['Debut', 'Date_debut'], fin: ['Fin', 'Date_fin'] };
const MOIS_AVANT = 1;   // la fenêtre s'ouvre au premier jour du mois précédent
const MOIS_TOTAL = 6;

const ETINCELLES = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" focusable="false">'
    + '<path d="M11 2.6 12.9 8.1 18.4 10 12.9 11.9 11 17.4 9.1 11.9 3.6 10 9.1 8.1z"/>'
    + '<path d="M18 13.4 18.8 15.6 21 16.4 18.8 17.2 18 19.4 17.2 17.2 15 16.4 17.2 15.6z"/>'
    + '</svg>';

let schemaMeta = null;
let projet = null;
let personnes = new Map();
let chantiers = [];
let taches = [];
let categories = [];
const chantiersReplies = new Set();

const el = (id) => document.getElementById(id);
const echapper = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gristVersDate = (ts) => (ts ? new Date(ts * 1000) : null);
const listeRefs = (v) => (Array.isArray(v) && v[0] === 'L' ? v.slice(1).map(Number) : []);
const jours = (a, b) => Math.round((b - a) / 86400000);

function typeColonne(tableId, colId) {
    if (!schemaMeta) return null;
    const t = (schemaMeta.tables || []).find((x) => x.tableId === tableId);
    if (!t) return null;
    const c = (schemaMeta.cols || []).find((x) => x.parentId === t.id && x.colId === colId);
    return c ? c.type : null;
}

// Le nom de la colonne appartient à qui tient la structure du document : c'est son type qui la
// désigne, comme dans le Gantt.
function colonneChantier() {
    if (typeColonne('Tasks', 'chantier') === 'Ref:Chantiers') return 'chantier';
    if (typeColonne('Tasks', 'parentTask') === 'Ref:Chantiers') return 'parentTask';
    const t = schemaMeta && (schemaMeta.tables || []).find((x) => x.tableId === 'Tasks');
    if (!t) return null;
    const c = (schemaMeta.cols || []).find((x) => x.parentId === t.id && x.type === 'Ref:Chantiers');
    return c ? c.colId : null;
}

// Une colonne de personnes designe sa table dans son type : la chercher sous un nom fige laissait
// les pastilles vides des que le document pointait ailleurs que sur Team.
const TABLE_PERSONNES = 'Team';
const COLONNES_PERSONNES = [
    ['Projects', 'responsable'], ['Projects', 'Sponsor'], ['Projects', 'Contributeurs_cles'],
    ['Chantiers', 'Responsable'], ['Tasks', 'Responsable'], ['Tasks', 'assignees']
];

function tableDeRef(tableId, colId) {
    const trouve = /^Ref(?:List)?:(.+)$/.exec(typeColonne(tableId, colId) || '');
    return trouve ? trouve[1] : TABLE_PERSONNES;
}

const refPersonne = (tableId, colId, v) => (v ? { table: tableDeRef(tableId, colId), id: v } : null);
const refsPersonnes = (tableId, colId, v) => (Array.isArray(v) && v[0] === 'L' ? v.slice(1) : [])
    .map((valeur) => ({ table: tableDeRef(tableId, colId), id: valeur }));

function colonneDateChantier(borne) {
    const noms = NOMS_DATE_CHANTIER[borne];
    if (!schemaMeta) return noms[0];
    return noms.find((n) => typeColonne('Chantiers', n) === 'Date') || noms[0];
}

// La catégorie se porte tantôt en référence vers une table, tantôt en liste de choix : la valeur
// suffit à trancher, un identifiant étant un nombre et un choix une chaîne.
function categorieDuProjet(p) {
    const v = p && p.Categorie;
    if (typeof v === 'number' && v > 0) {
        const c = categories.find((x) => x.id === v);
        return c ? (c.Categorie || '') : '';
    }
    return typeof v === 'string' ? v : '';
}

const clefNom = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase();

// Le serveur ne sert pas toujours l'identifiant d'une reference : sur grist.numerique.gouv.fr une
// reference simple arrive sous son libelle, la ou une liste garde ses identifiants. Les deux formes
// doivent retrouver la personne.
function membre(ref) {
    if (!ref) return null;
    const parId = personnes.get(ref.table + ':' + ref.id);
    if (parId) return parId;
    const parNom = personnes.get(ref.table + '#' + clefNom(ref.id));
    if (parNom) return parNom;
    console.warn('[fiche] personne introuvable', ref.table, ref.id);
    return null;
}
const initiales = (nom) => String(nom || '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');

const lundiDe = (d) => { const r = new Date(d); r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); r.setHours(0, 0, 0, 0); return r; };

/**
 * Fenêtre de six mois, du mois précédent au cinquième suivant. Les colonnes étant des semaines,
 * la fenêtre s'ouvre au lundi de la première et se ferme au dimanche de la dernière : sans cela
 * les positions se mesurent depuis le premier du mois et se décalent d'une colonne.
 */
function fenetre() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const premier = new Date(today.getFullYear(), today.getMonth() - MOIS_AVANT, 1);
    const dernier = new Date(today.getFullYear(), today.getMonth() - MOIS_AVANT + MOIS_TOTAL, 0);
    const debut = lundiDe(premier);
    const fin = lundiDe(dernier);
    fin.setDate(fin.getDate() + 6);
    return { premier: premier, debut: debut, fin: fin, duree: jours(debut, fin) + 1, today: today };
}

/** Colonnes hebdomadaires de la fenêtre, chacune rattachée à un des six mois affichés. */
function colonnes(f) {
    const out = [];
    for (let d = new Date(f.debut); d <= f.fin; d.setDate(d.getDate() + 7)) {
        const debutSemaine = new Date(d);
        const index = Math.min(Math.max((debutSemaine.getFullYear() - f.premier.getFullYear()) * 12 + debutSemaine.getMonth() - f.premier.getMonth(), 0), MOIS_TOTAL - 1);
        out.push({ debut: debutSemaine, mois: index, semaine: numeroSemaine(debutSemaine) });
    }
    return out;
}

function numeroSemaine(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const debutAnnee = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - debutAnnee) / 86400000 + 1) / 7);
}

/**
 * Position d'une barre, en pourcentage de la fenêtre. La brique px du core sert un Gantt qui
 * défile ; ici la fenêtre est fixe et suit la largeur de l'écran, une position relative la rend
 * responsive sans recalcul au redimensionnement.
 */
function barre(f, debut, fin) {
    if (!debut || !fin) return null;
    const d = Math.max(jours(f.debut, debut), 0);
    const t = Math.min(jours(f.debut, fin) + 1, f.duree);
    if (t <= 0 || d >= f.duree) return null;
    return { gauche: (d / f.duree) * 100, largeur: Math.max(((t - d) / f.duree) * 100, 0.6) };
}

/** Chantiers du projet, chacun suivi de ses tâches. */
function lignes() {
    const colChantier = colonneChantier();
    const colDebut = colonneDateChantier('debut');
    const colFin = colonneDateChantier('fin');
    const duProjet = chantiers.filter((c) => listeRefs(c.Projets).indexOf(projet.id) !== -1);
    const out = [];
    duProjet.forEach((c) => {
        const filles = colChantier ? taches.filter((t) => t[colChantier] === c.id) : [];
        const debuts = filles.map((t) => t.dateDebut).filter(Boolean);
        const fins = filles.map((t) => t.dateEcheance).filter(Boolean);
        out.push({
            id: 'c' + c.id, chantier: true, titre: c.Nom_du_chantier || 'Sans titre',
            debut: gristVersDate(c[colDebut] || (debuts.length ? Math.min.apply(null, debuts) : null)),
            fin: gristVersDate(c[colFin] || (fins.length ? Math.max.apply(null, fins) : null)),
            responsable: refPersonne('Chantiers', 'Responsable', c.Responsable), filles: filles.length
        });
        if (chantiersReplies.has(c.id)) return;
        filles.forEach((t) => out.push({
            id: 't' + t.id, chantier: false, titre: t.titre || 'Sans titre',
            debut: gristVersDate(t.dateDebut), fin: gristVersDate(t.dateEcheance),
            responsable: refPersonne('Tasks', 'Responsable', t.Responsable), progression: t.progression || 0,
            personnes: refsPersonnes('Tasks', 'assignees', t.assignees), parent: c.id
        }));
    });
    return out;
}

function bloc(classe, libelle, contenu) {
    return '<div class="fiche-bloc ' + classe + '"><div class="fiche-label">' + echapper(libelle) + '</div>'
        + '<div class="fiche-valeur">' + (contenu || '<span class="vide">Non renseigné</span>') + '</div></div>';
}

const ICONE_LIEN = '<svg class="fiche-lien" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">'
    + '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>';

function pastilles(refs, avecLien) {
    if (!refs.length) return '';
    return refs.map((ref) => {
        const m = membre(ref);
        if (!m) return '';
        return '<span class="fiche-personne">' + (avecLien ? ICONE_LIEN : '') + echapper(m.nom) + '</span>';
    }).join('');
}

/** Les personnes posees sur une ligne, en pastilles rondes ; au-dela de trois, un compteur. */
function avatars(r) {
    const ids = (r.personnes || []).slice();
    if (r.responsable && !ids.some((x) => x.table === r.responsable.table && x.id === r.responsable.id)) ids.unshift(r.responsable);
    if (!ids.length) return '';
    const montres = ids.slice(0, 3).map((ref) => {
        const m = membre(ref);
        if (!m) return '';
        return '<span class="fiche-avatar" style="--teinte:' + echapper(m.couleur || '#3e5de7') + '" title="' + echapper(m.nom || '') + '">'
            + echapper(initiales(m.nom)) + '</span>';
    }).join('');
    const reste = ids.length > 3 ? '<span class="fiche-avatar" style="--teinte:#64748b">+' + (ids.length - 3) + '</span>' : '';
    return '<span class="fiche-avatars">' + montres + reste + '</span>';
}

function texteOuVide(v) {
    const s = v == null ? '' : String(v).trim();
    return s ? echapper(s) : '';
}

function dateCourte(ts) {
    const d = gristVersDate(ts);
    return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function enTete() {
    const type = texteOuVide(projet.Type);
    return '<header class="fiche-entete">'
        + '<h1 class="fiche-titre">' + echapper(projet.nom || 'Sans titre') + '</h1>'
        + (type ? '<span class="fiche-type">' + type + '</span>' : '')
        + '</header>';
}

function cadrage() {
    return '<section class="fiche-cadrage">'
        + '<div class="fiche-colonne">'
        + bloc('bloc-responsable', 'Responsable', pastilles([refPersonne('Projects', 'responsable', projet.responsable)].filter(Boolean)))
        + bloc('bloc-sponsors', 'Sponsors', pastilles(refsPersonnes('Projects', 'Sponsor', projet.Sponsor), true))
        + bloc('bloc-contributeurs', 'Contributeurs clés', pastilles(refsPersonnes('Projects', 'Contributeurs_cles', projet.Contributeurs_cles), true))
        + '</div>'
        + '<div class="fiche-colonne large">'
        + bloc('bloc-description', 'Description', texteOuVide(projet.Description))
        + '<div class="fiche-trio">'
        + bloc('bloc-budget', 'Budget alloué', texteOuVide(projet.Budget_alloue))
        + bloc('bloc-commanditaires', 'Commanditaires', texteOuVide(projet.Commanditaires))
        + bloc('bloc-deadline', 'Deadline commanditaires', texteOuVide(dateCourte(projet.Deadline_commanditaire)))
        + '</div></div></section>';
}

function feuilleDeRoute() {
    const f = fenetre();
    const cols = colonnes(f);
    const rangs = lignes();
    const nbChantiers = rangs.filter((r) => r.chantier).length;

    if (!nbChantiers) {
        return '<section class="fiche-route"><h2>Feuille de route</h2>'
            + '<p class="fiche-message">Aucun chantier n\'est rattaché à ce projet.</p></section>';
    }

    const mois = [];
    for (let i = 0; i < MOIS_TOTAL; i++) {
        const d = new Date(f.premier.getFullYear(), f.premier.getMonth() + i, 1);
        const largeur = cols.filter((c) => c.mois === i).length;
        mois.push('<div class="fiche-mois" style="flex:' + largeur + '">' + echapper(d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')) + '</div>');
    }

    const lundiCourant = lundiDe(f.today);
    const semaines = cols.map((c) => '<div class="fiche-semaine' + (c.debut.getTime() === lundiCourant.getTime() ? ' courante' : '') + '">S' + c.semaine + '</div>').join('');

    const pourcent = (d) => (jours(f.debut, d) / f.duree) * 100;
    const aujourdhui = pourcent(f.today);
    const colonneCourante = { gauche: pourcent(lundiCourant), largeur: (7 / f.duree) * 100 };

    const corps = rangs.map((r) => {
        const b = barre(f, r.debut, r.fin);
        const replie = chantiersReplies.has(Number(r.id.slice(1)));
        const chevron = r.chantier && r.filles
            ? '<button class="fiche-chevron" data-chantier="' + r.id.slice(1) + '" aria-label="Replier ou déplier">' + (replie ? '▶' : '▼') + '</button>'
            : '<span class="fiche-chevron-vide"></span>';
        const teinte = r.responsable && membre(r.responsable) ? (membre(r.responsable).couleur || '#3e5de7') : '#4a9ae0';
        const periode = [r.debut, r.fin].every(Boolean)
            ? r.debut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' → ' + r.fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
            : '';
        return '<div class="fiche-rang' + (r.chantier ? ' est-chantier' : '') + '">'
            + '<div class="fiche-ligne">' + chevron
            + '<span class="fiche-marque" style="--teinte:' + echapper(teinte) + '"></span>'
            + '<span class="fiche-intitule"><span class="fiche-nom">' + echapper(r.titre) + '</span>'
            + (periode ? '<span class="fiche-dates">' + echapper(periode) + '</span>' : '') + '</span>'
            + '<span class="fiche-progression">' + Math.round(r.progression || 0) + '%</span>'
            + (r.filles ? '<span class="fiche-filles">↳' + r.filles + '</span>' : '')
            + avatars(r)
            + '</div>'
            + '<div class="fiche-piste">'
            + (b ? '<span class="fiche-barre" style="left:' + b.gauche.toFixed(2) + '%;width:' + b.largeur.toFixed(2) + '%;--teinte:' + echapper(teinte) + '">'
                + (r.progression ? '<span class="fiche-avancee" style="width:' + Math.min(Math.max(r.progression, 0), 100) + '%"></span>' : '')
                + '</span>' : '')
            + '</div></div>';
    }).join('');

    return '<section class="fiche-route">'
        + '<h2>' + (nbChantiers > 1 ? 'Feuilles de route des ' + nbChantiers + ' chantiers associés' : 'Feuille de route du chantier associé') + '</h2>'
        + '<div class="fiche-grille">'
        + '<div class="fiche-entetes"><div class="fiche-ligne fiche-ligne-tete">Tâches<span class="fiche-compteur">' + rangs.filter((r) => !r.chantier).length + '</span></div>'
        + '<div class="fiche-piste fiche-piste-tete"><div class="fiche-mois-ligne">' + mois.join('') + '</div><div class="fiche-semaines">' + semaines + '</div></div></div>'
        + '<div class="fiche-corps">'
        + '<div class="fiche-overlay fiche-fond"><div class="fiche-colonne-courante" style="left:' + colonneCourante.gauche.toFixed(2) + '%;width:' + colonneCourante.largeur.toFixed(2) + '%"></div></div>'
        + corps
        + '<div class="fiche-overlay"><div class="fiche-aujourdhui" style="left:' + aujourdhui.toFixed(2) + '%"></div></div>'
        + '</div></div></section>';
}

// Une categorie sans fiche annonce celle qui vient, plutot que de renvoyer l'utilisateur a ce
// que le widget ne fait pas.
function ficheAVenir(categorie) {
    return '<div class="fiche-bientot">'
        + '<span class="fiche-bientot-vignette" aria-hidden="true">' + ETINCELLES + '</span>'
        + '<p class="fiche-bientot-titre">La fiche ' + echapper(categorie) + ' arrive bientôt !</p>'
        + '<p class="fiche-bientot-texte">Une fiche adaptée à ' + echapper(projet.nom || 'cette ligne')
        + ' est en préparation. En attendant, sélectionnez un projet pour afficher la sienne.</p>'
        + '</div>';
}

function rendre() {
    const racine = el('fiche');
    if (!projet) {
        racine.innerHTML = '<p class="fiche-message">Sélectionnez un projet pour afficher sa fiche.</p>';
        return;
    }
    const categorie = categorieDuProjet(projet);
    if (categorie && categorie !== CATEGORIE_FICHE) {
        racine.innerHTML = enTete() + ficheAVenir(categorie);
        return;
    }
    racine.innerHTML = enTete() + messageDeRefus() + cadrage() + feuilleDeRoute();
    racine.querySelectorAll('.fiche-chevron').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.chantier);
        if (chantiersReplies.has(id)) chantiersReplies.delete(id); else chantiersReplies.add(id);
        rendre();
    }));
}

const LOG = '[fiche]';
// Tables déclarées par le document : demander une table absente fait remonter une erreur du bac à
// sable de Grist dans la console, avant même que notre garde ne la voie.
const tableDeclaree = (nom) => !schemaMeta || (schemaMeta.tables || []).some((t) => t.tableId === nom);

// Lectures encore en vol, par nom de table. Une lecture qui ne résout ni n'échoue laisserait la
// fiche sur son texte de chargement sans que rien ne désigne la table qui manque.
const lecturesEnAttente = new Set();
const DELAI_SANS_REPONSE = 10000;
// Tables déclarées par le document mais refusées à la lecture : un problème de droits donne le même
// écran vide qu'une donnée absente, et rien ne les distinguait.
let tablesRefusees = new Set();
let chargementCourant = 0;
let tablesChargees = false;

async function lire(table) {
    if (!tableDeclaree(table)) return [];
    lecturesEnAttente.add(table);
    try {
        return TF.columnarToRows(await grist.docApi.fetchTable(table));
    } catch (e) {
        console.warn(LOG, 'lecture refusée sur', table, ':', (e && e.message) || e);
        tablesRefusees.add(table);
        return [];
    } finally {
        lecturesEnAttente.delete(table);
    }
}

// Chargement encore en vol au bout du délai : nommer les tables qui n'ont pas répondu, et le dire
// à l'écran. Pas de repli sur des données d'exemple, les lectures pouvant encore aboutir.
function signalerAttente(sequence) {
    if (sequence !== chargementCourant || !lecturesEnAttente.size || projet) return;
    const noms = Array.from(lecturesEnAttente).join(', ');
    console.warn(LOG, 'aucune réponse pour', noms, 'après', Math.round(DELAI_SANS_REPONSE / 1000) + 's');
    el('fiche').innerHTML = '<p class="fiche-message">En attente de Grist. Pas de réponse pour '
        + echapper(noms) + '. La fiche s’affichera dès l’arrivée des données.</p>';
}

function messageDeRefus() {
    if (!tablesRefusees.size) return '';
    return '<p class="fiche-message fiche-refus">Lecture refusée sur : '
        + echapper(Array.from(tablesRefusees).join(', '))
        + '. La fiche est incomplète, vérifiez vos accès à ces tables.</p>';
}

async function chargerPersonnes() {
    const tables = Array.from(new Set([TABLE_PERSONNES].concat(COLONNES_PERSONNES.map((c) => tableDeRef(c[0], c[1])))));
    personnes = new Map();
    const lots = await Promise.all(tables.map((t) => lire(t)));
    tables.forEach((table, i) => {
        if (!lots[i].length) console.warn(LOG, 'aucune personne lue dans', table);
        lots[i].forEach((m) => {
            personnes.set(table + ':' + m.id, m);
            if (m.nom) personnes.set(table + '#' + clefNom(m.nom), m);
        });
    });
}

// Une sélection ne change que la ligne affichée : les tables, elles, ne bougent qu'à la main d'un
// utilisateur. Les relire à chaque clic coûtait sept allers-retours et 250 ko sur le document du
// métier, pour rendre exactement les mêmes données.
async function chargerTables() {
    const sequence = ++chargementCourant;
    tablesRefusees = new Set();
    const attente = setTimeout(() => signalerAttente(sequence), DELAI_SANS_REPONSE);
    try { schemaMeta = await TF.fetchSchemaMeta(grist); } catch (e) { schemaMeta = null; }
    const [lesChantiers, lesTaches, lesCategories] = await Promise.all([
        lire('Chantiers'), lire('Tasks'), lire('Categorie_de_projet')
    ]);
    await chargerPersonnes();
    clearTimeout(attente);
    // Une lecture partie avant celle-ci ne doit pas réinstaller son état par-dessus le nôtre.
    if (sequence !== chargementCourant) return false;
    chantiers = lesChantiers;
    taches = lesTaches;
    categories = lesCategories;
    tablesChargees = true;
    return true;
}

/**
 * L'enregistrement servi par onRecord dépend d'options que le serveur applique à sa façon : seul
 * son identifiant est fiable, les valeurs se lisent dans la table comme celles des autres.
 */
async function charger(selectionne, relire) {
    if (relire || !tablesChargees) {
        if (!(await chargerTables())) return;
    }
    const sequence = chargementCourant;
    const projets = await lire('Projects');
    if (sequence !== chargementCourant) return;
    projet = projets.find((p) => p.id === (selectionne || {}).id) || selectionne || null;
    rendre();
}

function demarrer() {
    try {
        grist.ready({ requiredAccess: 'full' });
        grist.onRecord(async (record) => await charger(record),
            { expandRefs: false, keepEncoded: true, includeColumns: 'normal' });
        // Grist ne notifie que la table du widget : une modification dans les chantiers, les tâches
        // ou les effectifs passerait inaperçue sans cette relecture.
        grist.onRecords(async () => await charger(projet, true));
    } catch (e) {
        el('fiche').innerHTML = '<p class="fiche-message">Cette fiche s’ouvre depuis un document Grist.</p>';
    }
}

demarrer();
