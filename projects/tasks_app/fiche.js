'use strict';

// Fiche d'un projet : son cadrage, puis la feuille de route de ses chantiers.
// Le widget est lié à la table Projects et ne travaille que sur l'enregistrement sélectionné.
// Lecture seule : rien ne s'y crée, ne s'y modifie ni ne s'y supprime.

const CATEGORIE_FICHE = 'Projet';
const NOMS_DATE_CHANTIER = { debut: ['Debut', 'Date_debut'], fin: ['Fin', 'Date_fin'] };
const MOIS_AVANT = 1;   // la fenêtre s'ouvre au premier jour du mois précédent
const MOIS_TOTAL = 6;

let schemaMeta = null;
let projet = null;
let equipe = [];
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

const membre = (id) => equipe.find((m) => m.id === id) || null;
const nomMembre = (id) => { const m = membre(id); return m ? (m.nom || '') : ''; };
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
            responsable: c.Responsable || null, filles: filles.length
        });
        if (chantiersReplies.has(c.id)) return;
        filles.forEach((t) => out.push({
            id: 't' + t.id, chantier: false, titre: t.titre || 'Sans titre',
            debut: gristVersDate(t.dateDebut), fin: gristVersDate(t.dateEcheance),
            responsable: t.Responsable || null, progression: t.progression || 0,
            personnes: listeRefs(t.assignees), parent: c.id
        }));
    });
    return out;
}

function bloc(classe, libelle, contenu) {
    return '<div class="fiche-bloc ' + classe + '"><div class="fiche-label">' + echapper(libelle) + '</div>'
        + '<div class="fiche-valeur">' + (contenu || '<span class="vide">Non renseigné</span>') + '</div></div>';
}

const ICONE_LIEN = '<svg class="fiche-lien" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">'
    + '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>';

function pastilles(ids, avecLien) {
    if (!ids.length) return '';
    return ids.map((id) => {
        const m = membre(id);
        if (!m) return '';
        return '<span class="fiche-personne">' + (avecLien ? ICONE_LIEN : '') + echapper(m.nom) + '</span>';
    }).join('');
}

/** Les personnes posees sur une ligne, en pastilles rondes ; au-dela de trois, un compteur. */
function avatars(r) {
    const ids = (r.personnes || []).slice();
    if (r.responsable && ids.indexOf(r.responsable) === -1) ids.unshift(r.responsable);
    if (!ids.length) return '';
    const montres = ids.slice(0, 3).map((id) => {
        const m = membre(id);
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
        + bloc('bloc-responsable', 'Responsable', pastilles(projet.responsable ? [projet.responsable] : []))
        + bloc('bloc-sponsors', 'Sponsors', pastilles(listeRefs(projet.Sponsor), true))
        + bloc('bloc-contributeurs', 'Contributeurs clés', pastilles(listeRefs(projet.Contributeurs_cles), true))
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

function rendre() {
    const racine = el('fiche');
    if (!projet) {
        racine.innerHTML = '<p class="fiche-message">Sélectionnez un projet pour afficher sa fiche.</p>';
        return;
    }
    const categorie = categorieDuProjet(projet);
    if (categorie && categorie !== CATEGORIE_FICHE) {
        racine.innerHTML = enTete()
            + '<p class="fiche-message fiche-hors-perimetre">Cette fiche ne concerne que les projets. '
            + echapper(projet.nom || 'Cette ligne') + ' est de catégorie ' + echapper(categorie) + '.</p>';
        return;
    }
    racine.innerHTML = enTete() + cadrage() + feuilleDeRoute();
    racine.querySelectorAll('.fiche-chevron').forEach((b) => b.addEventListener('click', () => {
        const id = Number(b.dataset.chantier);
        if (chantiersReplies.has(id)) chantiersReplies.delete(id); else chantiersReplies.add(id);
        rendre();
    }));
}

async function charger() {
    const lire = async (table) => {
        try { return TF.columnarToRows(await grist.docApi.fetchTable(table)); } catch (e) { return []; }
    };
    try { schemaMeta = await TF.fetchSchemaMeta(grist); } catch (e) { schemaMeta = null; }
    equipe = await lire('Team');
    chantiers = await lire('Chantiers');
    taches = await lire('Tasks');
    categories = await lire('Categorie_de_projet');
    rendre();
}

function demarrer() {
    try {
        grist.ready({ requiredAccess: 'full' });
        grist.onRecord(async (record) => { projet = record; await charger(); });
    } catch (e) {
        el('fiche').innerHTML = '<p class="fiche-message">Cette fiche s\'ouvre depuis un document Grist.</p>';
    }
}

demarrer();
