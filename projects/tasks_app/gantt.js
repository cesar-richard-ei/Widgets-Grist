
// ═══════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════
let gristReady = false;
// Handshake abouti : Grist est là, même si les tables tardent à revenir. Distinct de
// gristReady, posé en fin de chargement, qui autorise les écritures.
let gristPresent = false;
let tasks = [], team = [], projects = [];
let TASK_COLS = new Set(); // colonnes reelles de Tasks (sweet spot : charges/dateCloture n'existent que si le widget Plan a ete ouvert)
function pruneTaskRecord(rec) {
    // Le code manipule le rattachement sous le nom « chantier » : le traduire vers la colonne réelle
    // avant l'élagage, sinon l'écriture partirait sans son rattachement, et sans le dire.
    const colonne = colonneChantier();
    if (colonne && colonne !== 'chantier' && Object.prototype.hasOwnProperty.call(rec, 'chantier')) {
        rec[colonne] = rec.chantier;
        delete rec.chantier;
    }
    if (TASK_COLS.size) { for (const k in rec) if (!TASK_COLS.has(k)) delete rec[k]; }
    // TASK_COLS vient de la lecture, qui rend aussi les colonnes calculées : une colonne passée en
    // formule côté document est lisible mais refuse l'écriture, et emporte le lot avec elle.
    const ecrivables = colonnesEcrivables('Tasks');
    if (ecrivables) { for (const k in rec) if (!ecrivables.has(k)) delete rec[k]; }
    // Le parent affiché est recalculé à la lecture : l'identifiant décalé d'un chantier ne désigne
    // aucun enregistrement et ne doit jamais partir en base. Un parent qui désigne une tâche réelle
    // reste légitime, sans quoi on ne pourrait plus créer de sous-tâche.
    if (rec.parentTask >= ID_CHANTIER) delete rec.parentTask;
    return rec;
}
let statusCfg = TF.buildStatusConfig(TF.DEFAULT_STATUSES, 'default'); // #1 : statuts dynamiques, alimente par TF.loadStatusConfig
let schemaMeta = null; // métadonnées Grist (_grist_Tables[_column]) lues une fois par ouverture, partagées entre helpers
let currentView = 'semester';
let viewStartDate = new Date();
let ganttNowAligned = false;
let selectedTaskId = null;
let sortMode = 'date';
let colorMode = 'responsable';
let categoriesProjet = [];
// Bandeaux replies, par identifiant de projet. Persiste comme le repli des taches.
let groupesReplies = new Set();
try { groupesReplies = new Set(JSON.parse(localStorage.getItem('taskflow_gantt_groupes_replies') || '[]').map(Number).filter(n => !isNaN(n))); } catch (e) {}
// WBS-02: état expand/collapse par tâche parente
let expandedTasks = new Set();
try { expandedTasks = new Set(JSON.parse(localStorage.getItem('taskflow_gantt_expanded') || '[]').map(Number).filter(n => !isNaN(n))); } catch (e) {}
let sortableInstance = null;
let filters = { project: [], assignee: [], priority: [], domaine: [] };  // GEN-02: Arrays pour compatibilité inter-widgets
// Filtres cross-page : persistés en localStorage, cloisonnés par document (setOption reste par-section).
let filterDocId = 'local';
function filterStorageKey() { return 'taskflow_gantt_filters:' + filterDocId; }
function persistFilters() {
    try { localStorage.setItem(filterStorageKey(), JSON.stringify({ project: filters.project, assignee: filters.assignee, priority: filters.priority, domaine: filters.domaine })); } catch (e) {}
}
function hydrateFilters() {
    try {
        const s = JSON.parse(localStorage.getItem(filterStorageKey()) || 'null');
        if (!s) return;
        filters.project = Array.isArray(s.project) ? s.project : [];
        filters.assignee = Array.isArray(s.assignee) ? s.assignee : [];
        filters.priority = Array.isArray(s.priority) ? s.priority : [];
        filters.domaine = Array.isArray(s.domaine) ? s.domaine : [];
    } catch (e) {}
}
// Vue appliquée : on retire les ids absents des données courantes (ex. autre page/table), la priorité reste universelle.
function effectiveFilters() {
    return {
        project: filters.project.filter(id => projects.some(p => p.id === id)),
        assignee: filters.assignee.filter(id => team.some(m => m.id === id)),
        priority: filters.priority,
        domaine: filters.domaine.filter(d => domainesConnus().includes(d))
    };
}

// Le domaine d'une personne, c'est son équipe : la colonne `Team.Domaine`, facultative comme celles
// du Plan. Sans elle, il n'y a pas de domaine à proposer et le groupe de filtre disparaît.
function domainesConnus() {
    const vus = [];
    for (const m of team) if (m.Domaine && !vus.includes(m.Domaine)) vus.push(m.Domaine);
    return vus.sort();
}
// Les domaines sont désignés par leur rang, pour n'avoir rien à échapper dans un attribut onclick.
function basculerDomaine(rang) {
    const d = domainesConnus()[rang];
    if (d) toggleFilter('domaine', d);
}
let dragState = { active: false, type: null, taskId: null, startX: 0, originalLeft: 0, originalWidth: 0, originalStart: null, originalEnd: null, deplace: false };
let panelState = { open: false, isNew: false, taskId: null, taskIndex: -1, taskList: [], editData: null, dirty: false };
let effectiveStart = new Date();    // Plage effective calculée à chaque render()
let effectiveDays = 30;             // = période vue + extension pour tâches qui chevauchent
let effectiveCellWidth = 60;        // Largeur cellule adaptée (min = cfg.cellWidth, max = remplir widget)
let effectivePxPerDay = 34;         // pxPerDay réel (utilisé aussi dans drag/drop)
let saveTimeout = null;
// Geste souris en cours (mousedown -> mouseup, plus un court sursis apres le
// relachement) : tant qu'il dure, render() ne doit pas reconstruire #taskList ni
// #timelineGrid, sinon la ligne ou la barre visee est arrachee du DOM avant que le
// navigateur emette 'click'.
let gesteSourisEnCours = false;
let renduEnAttente = false;
let timeoutDesarmement = null; // id du setTimeout de desarmement du mouseup, pour pouvoir l'annuler

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════
const escapeHtml = (t) => { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
const gristToDate = (ts) => { if (ts == null || ts === '') return null; const n = Number(ts); return isNaN(n) ? null : new Date(n * 1000); };
const dateToGrist = (d) => d ? Math.floor(d.getTime() / 1000) : null;
const formatDate = (d) => d ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '-';
const formatDateShort = (d) => d ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(d) : '-';
const formatDateISO = (d) => d ? d.toISOString().split('T')[0] : '';
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const isSameDay = (a, b) => a && b && a.toDateString() === b.toDateString();
const getDaysDiff = (a, b) => Math.round((b - a) / 86400000);
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const getTaskPriority = (t) => (t?.priorite >= 1 && t?.priorite <= 4) ? parseInt(t.priorite) : 3;
const isJalon = (t) => t?.type === 'jalon';

function showToast(msg, type = 'info') { const c = document.getElementById('toastContainer'); const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; c.appendChild(t); setTimeout(() => t.remove(), 3000); }

// Un refus d'écriture porte la raison, la perdre laisse l'utilisateur devant un échec muet et
// personne ne sait quelle colonne pose problème. Tronqué : le toast n'a pas la place d'une trace.
function messageErreur(e) {
    const brut = (e && (e.message || e.error)) || String(e || '');
    return brut.length > 120 ? brut.slice(0, 120) + '…' : brut;
}

// GEN-03: Export functions
// WBS-02: déplie toute la hiérarchie temporairement pour l'export, retourne l'état précédent
function _expandAllForExport() {
    const prev = new Set(expandedTasks);
    for (const t of tasks) if (hasChildren(t)) expandedTasks.add(t.id);
    render();
    return prev;
}
function _restoreExpandState(prev) { expandedTasks = prev; render(); }
function exportPrint() {
    document.querySelectorAll('.filter-menu').forEach(m => m.classList.remove('open'));
    const prev = _expandAllForExport();
    setTimeout(() => { window.print(); setTimeout(() => _restoreExpandState(prev), 500); }, 200);
}

async function exportPNG() {
    document.querySelectorAll('.filter-menu').forEach(m => m.classList.remove('open'));
    showToast('Préparation export...', 'info');

    // Load html2canvas dynamically
    if (!window.html2canvas) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        document.head.appendChild(script);
        await new Promise(resolve => script.onload = resolve);
    }

    const prev = _expandAllForExport();
    await new Promise(r => setTimeout(r, 100)); // attendre re-render
    try {
        const element = document.getElementById('ganttWrapper');
        const canvas = await html2canvas(element, {
            backgroundColor: '#ffffff',
            scale: 2,
            logging: false,
            useCORS: true
        });

        const link = document.createElement('a');
        link.download = 'gantt-' + new Date().toISOString().split('T')[0] + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('Export PNG réussi', 'success');
    } catch (e) {
        console.error('Export error:', e);
        showToast('Erreur export PNG', 'error');
    } finally {
        _restoreExpandState(prev);
    }
}
function showSaveIndicator() { const el = document.getElementById('saveIndicator'); el.classList.add('visible'); clearTimeout(saveTimeout); saveTimeout = setTimeout(() => el.classList.remove('visible'), 1500); }

// RefList/ChoiceList helpers
function getRefListArray(val) { if (!val) return []; if (Array.isArray(val)) return val[0] === 'L' ? val.slice(1).map(Number).filter(n => !isNaN(n)) : val.map(Number).filter(n => !isNaN(n)); return []; }
function toGristRefList(arr) { return arr && arr.length ? ['L', ...arr] : null; }
function getChoiceListArray(val) { if (!val) return []; if (Array.isArray(val)) return val[0] === 'L' ? val.slice(1) : val; return []; }
function toGristChoiceList(arr) { return arr && arr.length ? ['L', ...arr] : null; }
const getAssigneesArray = (t) => getRefListArray(t?.assignees);
const getDependsOnArray = (t) => getRefListArray(t?.dependDe);
// Un lien début→début se lit dans sa propre colonne : Grist tient une RefList par type de lien,
// plutôt qu'un type porté à côté d'une liste unique, qui ne se relirait pas dans le document. La
// colonne appartient à la structure du document, elle est donc facultative : sans elle, les liens
// début→début disparaissent du volet comme du tracé.
const COL_DEP_DEBUT = 'dependDebutDe';
const getStartDependsOnArray = (t) => getRefListArray(t?.[COL_DEP_DEBUT]);
const depDebutDisponible = () => TASK_COLS.has(COL_DEP_DEBUT);
const getTagsArray = (t) => getChoiceListArray(t?.tags);

// Project/Team helpers
const getProjectName = (id) => { const p = projects.find(x => x.id === id); return p?.nom || ''; };
const getProjectColor = (id) => { const p = projects.find(x => x.id === id); return p?.couleur || '#64748b'; };
const getTeamMemberName = (id) => { const m = team.find(x => x.id === id); return m?.nom || ''; };
const getTeamMemberColor = (id) => { const m = team.find(x => x.id === id); return m?.couleur || '#3e5de7'; };
const getInitials = (n) => n ? n.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2) : '?';

// Couleur d'une tâche selon le mode courant, avec override individuel (task.couleur)
function getTaskColor(t) {
    if (t?.couleur && /^#[0-9a-f]{3,8}$/i.test(t.couleur)) return t.couleur;
    switch (colorMode) {
        case 'project': return t?.projet ? getProjectColor(t.projet) : '#94a3b8';
        case 'responsable': return t?.Responsable ? getTeamMemberColor(t.Responsable) : '#94a3b8';
        case 'assignee': { const a = getAssigneesArray(t); return a.length ? getTeamMemberColor(a[0]) : '#94a3b8'; }
        case 'status': return TF.getStatus(statusCfg, t?.statut || statusCfg.firstValue).fillColor;
        case 'priority':
        default: return PRIORITY_COLORS[getTaskPriority(t)];
    }
}
function getTaskBarGradient(t) {
    const c = getTaskColor(t);
    return 'linear-gradient(135deg, ' + c + ', color-mix(in srgb, ' + c + ' 70%, white))';
}

// ═══════════════════════════════════════════════════════════════════════
// WBS (hiérarchie sous-tâches) — API commune
// ═══════════════════════════════════════════════════════════════════════
let childrenByParent = new Map();  // reconstruit à chaque loadAllData
// Type d'une colonne d'après les métadonnées Grist, null si la table ou la colonne manque.
function typeColonne(tableId, colId) {
    if (!schemaMeta) return null;
    const t = (schemaMeta.tables || []).find(x => x.tableId === tableId);
    if (!t) return null;
    const c = (schemaMeta.cols || []).find(x => x.parentId === t.id && x.colId === colId);
    return c ? c.type : null;
}

// Les dates d'un chantier ne portent pas le même nom partout : le document du métier les appelle
// Debut et Fin. On retient la première qui existe et qui est bien une date, sans quoi
// pruneChantierRecord les élague et aucune date de chantier ne part en base.
const NOMS_DATE_CHANTIER = { debut: ['Date_debut', 'Debut'], fin: ['Date_fin', 'Fin'] };
function colonneDateChantier(borne) {
    const noms = NOMS_DATE_CHANTIER[borne];
    if (!schemaMeta) return noms[0];
    return noms.find(n => typeColonne('Chantiers', n) === 'Date') || noms[0];
}

// Le rattachement d'une tâche à son chantier est porté par Tasks.chantier. Sur les documents où
// parentTask a été repointé vers Chantiers sans que la colonne existe encore, c'est parentTask qui
// le porte : on se fie au type déclaré, jamais à la valeur.
function colonneChantier() {
    if (typeColonne('Tasks', 'chantier') === 'Ref:Chantiers') return 'chantier';
    if (typeColonne('Tasks', 'parentTask') === 'Ref:Chantiers') return 'parentTask';
    // Le document du métier nomme la colonne « Chantiers ». Le lien se reconnaît à son type, le nom
    // appartenant à la personne qui tient la structure du document.
    const t = schemaMeta && (schemaMeta.tables || []).find(x => x.tableId === 'Tasks');
    if (!t) return null;
    const c = (schemaMeta.cols || []).find(x => x.parentId === t.id && x.type === 'Ref:Chantiers');
    return c ? c.colId : null;
}
// Colonnes d'une table dans lesquelles une écriture a une chance d'aboutir : celles qui existent, et
// qui ne sont pas calculées. Rend null quand les métadonnées manquent, auquel cas rien n'est élagué.
function colonnesEcrivables(tableId) {
    if (!schemaMeta) return null;
    const t = (schemaMeta.tables || []).find(x => x.tableId === tableId);
    if (!t) return null;
    return new Set((schemaMeta.cols || []).filter(c => c.parentId === t.id && !c.isFormula).map(c => c.colId));
}

// Grist rejette le lot entier dès qu'une action vise une colonne absente ou calculée : une seule
// colonne en trop et rien n'est enregistré. Les tâches passent par pruneTaskRecord ; les chantiers
// vivent dans une table que le widget ne crée pas, dont la structure appartient au document, d'où le
// même élagage avant chaque écriture. La création posait Projets sans ce filet, ce que la
// modification ne fait pas : elle seule échouait sur un document où la colonne est calculée.
function pruneChantierRecord(rec) {
    const colonnes = colonnesEcrivables('Chantiers');
    if (colonnes) { for (const k in rec) if (!colonnes.has(k)) delete rec[k]; }
    return rec;
}

// parentTask ne désigne une sous-tâche que lorsqu'il pointe Tasks. Sans ce garde-fou, un parentTask
// qui désigne un chantier rattache les tâches entre elles, les identifiants des deux tables se
// recouvrant.
const parentTaskEstHierarchie = () => typeColonne('Tasks', 'parentTask') === 'Ref:Tasks';

// Les identifiants de Chantiers et de Tasks se recouvrent : décalage pour cohabiter dans un même
// tableau, tout le rendu de l'arbre ne manipulant que des identifiants numériques.
const ID_CHANTIER = 1000000;
const estChantier = (t) => !!t && t.estChantier === true;

function chantierEnLigne(c) {
    const projets = getRefListArray(c.Projets);
    return {
        id: ID_CHANTIER + c.id, idChantier: c.id, estChantier: true,
        titre: c.Nom_du_chantier || '', description: c.Description || '',
        dateDebut: c[colonneDateChantier('debut')] || null, dateEcheance: c[colonneDateChantier('fin')] || null,
        projet: projets.length ? projets[0] : 0,
        assignees: c.Contributeurs || null, Responsable: c.Responsable || null,
        type: 'tache', statut: '', priorite: null, parentTask: null
    };
}

// Insère les chantiers comme lignes de niveau 0 et réécrit le parent de chaque tâche : sa tâche
// parente si elle en a une, sinon son chantier.
async function fusionnerChantiers() {
    const colonne = colonneChantier();
    if (!colonne) return;
    let brut;
    try { brut = await grist.docApi.fetchTable('Chantiers'); } catch (e) { noterRefus('Chantiers'); return; }
    const chantiers = convert(brut).map(chantierEnLigne);
    const parProjet = new Map(chantiers.map(c => [c.idChantier, c.projet]));
    const hierarchie = parentTaskEstHierarchie();
    for (const t of tasks) {
        const idChantier = t[colonne];
        t.chantier = idChantier || null;
        const sousTacheDe = hierarchie ? t.parentTask : null;
        t.parentTask = sousTacheDe || (idChantier ? ID_CHANTIER + idChantier : null);
        if (!t.projet && idChantier && parProjet.has(idChantier)) t.projet = parProjet.get(idChantier);
    }
    tasks = chantiers.concat(tasks);
}

// Données du volet pour un chantier. Les dates absentes sont préremplies depuis ses tâches, tout en
// restant modifiables ; les assignés et les charges sont des remontées de ses tâches, pas des
// valeurs propres au chantier.
function donneesChantier(c) {
    const taches = getAllDescendants(c.id).filter(t => !estChantier(t));
    const bornes = aggregateDates(c);
    const assignes = [];
    for (const t of taches) for (const id of getAssigneesArray(t)) if (!assignes.includes(id)) assignes.push(id);
    const cumul = new Map();
    for (const t of taches) {
        for (const ch of TF.parseCharges(t.charges)) cumul.set(ch.teamId, (cumul.get(ch.teamId) || 0) + (Number(ch.heures) || 0));
    }
    return {
        titre: c.titre, description: c.description || '', type: 'chantier',
        dateDebut: c.dateDebut || bornes.start || null,
        dateEcheance: c.dateEcheance || bornes.end || null,
        projet: c.projet || null,
        Responsable: c.Responsable || null,
        assignees: assignes,
        charges: Array.from(cumul, ([teamId, heures]) => ({ teamId: teamId, heures: heures })),
        dependDe: [], dependDebutDe: [], tags: [], subtasks: [], progression: 0, priorite: null,
        estimationH: null, tempsPasse: null, couleur: null, parentTask: null
    };
}

function rebuildChildrenCache() {
    childrenByParent = new Map();
    // WBS-FIX: ignorer les parentTask qui formeraient un cycle (self-ref ou chaîne circulaire)
    const cycleIds = new Set();
    for (const t of tasks) {
        const seen = new Set([t.id]);
        let cur = t.parentTask ? tasks.find(x => x.id === t.parentTask) : null;
        let guard = 0;
        while (cur && guard++ < 128) {
            if (seen.has(cur.id)) { cycleIds.add(t.id); break; }
            seen.add(cur.id);
            cur = cur.parentTask ? tasks.find(x => x.id === cur.parentTask) : null;
        }
    }
    if (cycleIds.size) console.warn('WBS: cycles detected on task ids:', [...cycleIds]);
    for (const t of tasks) {
        const pid = t.parentTask;
        if (pid && !isNaN(pid) && !cycleIds.has(t.id)) {
            if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
            childrenByParent.get(pid).push(t);
        }
    }
}
const isRoot = (t) => !t?.parentTask;
const getParent = (t) => t?.parentTask ? tasks.find(x => x.id === t.parentTask) : null;
const getChildren = (id) => childrenByParent.get(id) || [];
const hasChildren = (t) => t && getChildren(t.id).length > 0;
function getDepth(t) { let d = 0, cur = t, guard = 0; while (cur?.parentTask && guard++ < 32) { cur = tasks.find(x => x.id === cur.parentTask); d++; } return d; }
// Itératif DFS pour éviter stack overflow
function walkTree(roots, cb, depth = 0) {
    const stack = roots.map(r => ({ task: r, depth: 0 }));
    while (stack.length) {
        const { task, depth: d } = stack.shift();
        cb(task, d);
        const kids = getChildren(task.id);
        if (kids.length) {
            for (let i = kids.length - 1; i >= 0; i--) stack.unshift({ task: kids[i], depth: d + 1 });
        }
    }
}
function getAllDescendants(id, acc = [], visited = new Set()) {
    if (visited.has(id)) return acc;  // WBS-FIX: anti-cycle
    visited.add(id);
    const kids = getChildren(id);
    for (const k of kids) { acc.push(k); getAllDescendants(k.id, acc, visited); }
    return acc;
}
// Anti-cycle : true si newParent peut être affecté à taskId sans créer de boucle
function canSetParent(taskId, newParent) {
    if (!newParent) return true;
    if (newParent === taskId) return false;
    let cur = tasks.find(x => x.id === newParent);
    let guard = 0;
    while (cur && guard++ < 64) {
        if (cur.id === taskId) return false;
        cur = cur.parentTask ? tasks.find(x => x.id === cur.parentTask) : null;
    }
    return true;
}
// Agrégations — calculées à la demande, JAMAIS persistées côté Grist
function aggregateProgress(t, visited = new Set()) {
    if (visited.has(t.id)) return t.progression || 0;
    visited.add(t.id);
    const kids = getChildren(t.id);
    if (!kids.length) return t.progression || 0;
    const allWeighted = kids.every(k => k.estimationH && k.estimationH > 0);
    if (allWeighted) {
        const totalW = kids.reduce((s, k) => s + k.estimationH, 0);
        return Math.round(kids.reduce((s, k) => s + aggregateProgress(k, visited) * k.estimationH, 0) / totalW);
    }
    return Math.round(kids.reduce((s, k) => s + aggregateProgress(k, visited), 0) / kids.length);
}
function aggregateDates(t, visited = new Set()) {
    if (visited.has(t.id)) return { start: t.dateDebut, end: t.dateEcheance };
    visited.add(t.id);
    const kids = getChildren(t.id);
    if (!kids.length) return { start: t.dateDebut, end: t.dateEcheance };
    let minS = t.dateDebut, maxE = t.dateEcheance;
    for (const k of kids) {
        const sub = aggregateDates(k, visited);
        if (sub.start != null && (minS == null || sub.start < minS)) minS = sub.start;
        if (sub.end != null && (maxE == null || sub.end > maxE)) maxE = sub.end;
    }
    return { start: minS, end: maxE };
}
// Date sur laquelle une ligne se trie : la sienne, sinon celle que sa barre affiche, agrégée de ses
// enfants. Le document du métier ne saisit pas les dates d'un chantier : les lire brutes les rendait
// toutes vides, donc égales, et le tri par date laissait l'ordre d'insertion en place.
function dateDeTri(t) {
    if (t.dateDebut != null) return t.dateDebut;
    const agrege = aggregateDates(t).start;
    return agrege != null ? agrege : 0;
}
// WBS-02: toggle expand/collapse d'une branche
function toggleExpand(id) {
    if (expandedTasks.has(id)) expandedTasks.delete(id); else expandedTasks.add(id);
    localStorage.setItem('taskflow_gantt_expanded', JSON.stringify([...expandedTasks]));
    render();
}
// WBS-02: replie toutes les branches d'un coup (fermeture seule, pas d'ouverture)
function collapseAll() {
    if (!expandedTasks.size) return;
    expandedTasks.clear();
    localStorage.setItem('taskflow_gantt_expanded', JSON.stringify([]));
    render();
}
// Tri au sein d'une fratrie selon sortMode
function sortFratrie(arr) {
    if (sortMode === 'priority') {
        return arr.slice().sort((a, b) => { const pa = getTaskPriority(a), pb = getTaskPriority(b); return pa !== pb ? pa - pb : dateDeTri(a) - dateDeTri(b); });
    }
    if (sortMode === 'date') {
        return arr.slice().sort((a, b) => dateDeTri(a) - dateDeTri(b));
    }
    return arr.slice(); // 'manual' — respecte l'ordre dans tasks[]
}
// Les chantiers d'un même projet restent affichés ensemble : le tri courant s'applique
// à l'intérieur de chaque projet, et les projets se suivent dans l'ordre de leur premier
// chantier. Sans cela, un tri par date entrelace les projets ligne à ligne.
function grouperParProjet(racines) {
    const groupes = new Map();
    for (const t of racines) {
        const cle = t.projet || 0;
        if (!groupes.has(cle)) groupes.set(cle, []);
        groupes.get(cle).push(t);
    }
    const out = [];
    for (const groupe of groupes.values()) out.push(...groupe);
    return out;
}

// Construit la liste aplatie des tâches visibles (DFS) avec respect filtres + expand/collapse
// Renvoie [{task, depth, dimmed}]
function buildVisibleTasks() {
    const filtered = getFilteredTasks();
    const directMatches = new Set(filtered.map(t => t.id));
    // branches = tâches dont elles-mêmes OU un ancêtre OU un descendant match
    const branchTasks = new Set();
    for (const t of filtered) {
        let cur = t, guard = 0;
        while (cur && guard++ < 64) {
            branchTasks.add(cur.id);
            cur = cur.parentTask ? tasks.find(x => x.id === cur.parentTask) : null;
        }
        for (const d of getAllDescendants(t.id)) branchTasks.add(d.id);
    }
    // Racines (tâches sans parent existant)
    const rootsAll = tasks.filter(t => !t.parentTask || !tasks.find(x => x.id === t.parentTask));
    const roots = grouperParProjet(sortFratrie(rootsAll.filter(t => branchTasks.has(t.id))));
    const visible = [];
    const walk = (node, depth) => {
        const dimmed = !directMatches.has(node.id);
        visible.push({ task: node, depth, dimmed });
        if (hasChildren(node) && expandedTasks.has(node.id)) {
            const kids = sortFratrie(getChildren(node.id).filter(k => branchTasks.has(k.id)));
            for (const k of kids) walk(k, depth + 1);
        }
    };
    for (const r of roots) walk(r, 0);
    return avecBandeauxDeProjet(visible);
}

// Tasks et Chantiers portent chacune leur colonne Responsable, indépendamment : sur un chantier,
// c'est celle de sa table qui décide, sinon la saisie n'aurait pas de destination.
function responsableDisponible() {
    if (!panelState.estChantier) return TASK_COLS.has('Responsable');
    const colonnes = colonnesEcrivables('Chantiers');
    return !colonnes || colonnes.has('Responsable');
}

// Le responsable reprend la présentation des contributeurs, mais n'accepte qu'une personne : c'est
// lui qui porte la couleur de la ligne. La colonne étant facultative, la ligne disparaît avec elle.
function ligneResponsable(data, options, recherche, sansResultat) {
    if (!responsableDisponible()) return '';
    const choisi = data.Responsable
        ? '<div class="asg-list"><div class="asg resp-choisi"><span class="asg-ava" style="background:' + getTeamMemberColor(data.Responsable) + '">' + getInitials(getTeamMemberName(data.Responsable)) + '</span>' +
          '<span class="an">' + escapeHtml(getTeamMemberName(data.Responsable)) + '</span>' +
          '<button class="asg-x" title="Retirer" onclick="choisirResponsable(null)">×</button></div></div>'
        : '';
    return '<div class="prop-row"><span class="prop-label">Responsable</span><div class="prop-value">' + choisi +
        '<div class="multi-select" id="responsableSelect"><button class="addbtn" onclick="toggleMultiSelect(\'responsableSelect\')"><span style="font-size:1rem;line-height:1">+</span> ' +
        (data.Responsable ? 'Changer de responsable' : 'Choisir un responsable') + '</button>' +
        '<div class="multi-select-dropdown">' + recherche + (options || '<div class="multi-select-empty">Aucun membre</div>') + sansResultat + '</div></div>' +
    '</div></div>';
}

function choisirResponsable(id) {
    updateField('Responsable', id || null);
    const menu = document.getElementById('responsableSelect');
    if (menu) menu.classList.remove('open');
}

// Les blocs de propriétés sont posés par paquets, dans l'ordre du cadrage : un paquet dont toutes
// les lignes sont masquées ne doit pas laisser de cadre vide.
function groupeDeProps(...blocs) {
    const corps = blocs.join('');
    return corps ? '<div class="props-list">' + corps + '</div>' : '';
}

// Version servie, posée à la construction du site : le tag pour la racine, « dev » pour la version
// nightly. Le marqueur reste tel quel sur une copie locale, qui n'est passée par aucun déploiement.
const VERSION_SERVIE = '__VERSION_TASKFLOW__';

// Repère de déploiement, réservé à qui l'active : localStorage taskflow_show_version = "true".
function afficherVersion() {
    const badge = document.getElementById('badgeVersion');
    if (!badge) return;
    let actif;
    try { actif = localStorage.getItem('taskflow_show_version') === 'true'; } catch (e) { actif = false; }
    if (!actif) return;
    badge.textContent = VERSION_SERVIE.indexOf('__') === 0 ? 'local' : VERSION_SERVIE;
    badge.hidden = false;
}

// Une tâche appartient toujours à un chantier : le rattachement s'édite dans sa propre section, sur
// un document qui porte la table. Le nom réel de la colonne est résolu à l'écriture.
function sectionChantier(data) {
    if (!colonneChantier()) return '';
    const chantiers = tasks.filter(estChantier);
    if (!chantiers.length) return '';
    const options = chantiers.map(c => '<option value="' + c.idChantier + '"' + (data.chantier === c.idChantier ? ' selected' : '') + '>' + escapeHtml(c.titre || 'Sans titre') + '</option>').join('');
    return '<div class="panel-section"><div class="panel-section-header"><span class="panel-section-title">Chantier</span></div>' +
        '<div class="form-group"><select class="form-select" id="chantierSelect" onchange="updateField(\'chantier\', parseInt(this.value, 10) || null)">' +
            '<option value=""' + (data.chantier ? '' : ' selected') + '>Sans chantier</option>' + options +
        '</select></div></div>';
}

// Deux têtes par ligne, le responsable puis un contributeur, le reste de l'équipe passe dans le
// compteur. Sans responsable renseigné, les deux premiers contributeurs tiennent la place.
function pastillesDeLigne(t, assignees) {
    const responsable = t.Responsable || null;
    const montres = [];
    if (responsable) montres.push(responsable);
    for (const id of assignees) {
        if (montres.length >= 2) break;
        if (!montres.includes(id)) montres.push(id);
    }
    if (!montres.length) return '';
    const autres = assignees.filter(id => !montres.includes(id)).length;
    const pastille = (id) => '<div class="task-avatar" style="background:' + getTeamMemberColor(id) + '" title="' + escapeHtml(getTeamMemberName(id)) + '">' + getInitials(getTeamMemberName(id)) + '</div>';
    return '<div class="task-avatars">' + montres.map(pastille).join('') +
        (autres > 0 ? '<div class="task-avatar more" title="' + autres + ' autre' + (autres > 1 ? 's' : '') + '">+' + autres + '</div>' : '') +
    '</div>';
}

// Nom de la catégorie d'un projet (Projet / Produit / Offre de service), vide si le document ne
// porte pas la table ou si le projet n'en a pas.
function categorieDuProjet(projet) {
    if (!projet || !projet.Categorie) return '';
    const c = categoriesProjet.find(x => x.id === projet.Categorie);
    return c ? (c.Categorie || '') : '';
}

// Insère un bandeau devant chaque groupe de projet. Le bandeau occupe une ligne à part entière :
// la timeline pose ses barres à l'index de la ligne, un bandeau sans ligne décalerait tout.
// Teinte du bandeau : celle du responsable du projet, à défaut celle du projet. Posée en fond
// translucide pour rester lisible sous le texte, en clair comme en sombre.
function couleurDeGroupe(projet) {
    if (!projet) return '#94a3b8';
    // Couleur du responsable seulement s'il en porte une : sans ce test, un responsable sans
    // couleur renverrait le bleu par défaut et tous les bandeaux se ressembleraient.
    const resp = projet.responsable ? team.find(m => m.id === projet.responsable) : null;
    if (resp && resp.couleur) return resp.couleur;
    return projet.couleur || '#94a3b8';
}

function fondTranslucide(couleur, part) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(couleur || '');
    if (!m) return 'transparent';
    return 'rgba(' + parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16) + ', ' + part + ')';
}

// La teinte est posée en aplat par-dessus le fond opaque de la ligne, et non en fond translucide :
// deux bandeaux collés en haut se recouvrent au défilement, et on lirait sinon les deux titres
// superposés.
function aplatDeTeinte(couleur, part) {
    const teinte = fondTranslucide(couleur, part);
    return 'linear-gradient(' + teinte + ', ' + teinte + ')';
}

function avecBandeauxDeProjet(visible) {
    const out = [];
    let projetPrecedent = null;
    for (const entree of visible) {
        if (entree.depth === 0) {
            const idProjet = entree.task.projet || 0;
            if (out.length === 0 || idProjet !== projetPrecedent) {
                const projet = projects.find(p => p.id === idProjet);
                out.push({
                    groupe: {
                        id: idProjet,
                        nom: projet ? projet.nom : 'Sans projet',
                        categorie: categorieDuProjet(projet),
                        couleur: couleurDeGroupe(projet),
                        replie: groupesReplies.has(idProjet)
                    },
                    depth: 0
                });
                projetPrecedent = idProjet;
            }
            if (groupesReplies.has(idProjet)) continue;
        } else if (groupesReplies.has(projetPrecedent)) {
            continue;
        }
        out.push(entree);
    }
    return out;
}

function toggleGroupeProjet(idProjet) {
    if (groupesReplies.has(idProjet)) groupesReplies.delete(idProjet); else groupesReplies.add(idProjet);
    localStorage.setItem('taskflow_gantt_groupes_replies', JSON.stringify([...groupesReplies]));
    render();
}

// Prédécesseurs d'une tâche, tous types de lien confondus : un cycle se forme aussi bien par des
// fin→début que par des début→début, ou en mélangeant les deux.
const getAllPredecessors = (t) => getDependsOnArray(t).concat(getStartDependsOnArray(t));

// Dependency cycle detection
function wouldCreateCycle(taskId, depId, visited = new Set()) {
    if (taskId === depId) return true;
    if (visited.has(depId)) return false;
    visited.add(depId);
    const depTask = tasks.find(t => t.id === depId);
    if (!depTask) return false;
    return getAllPredecessors(depTask).some(d => wouldCreateCycle(taskId, d, visited));
}
function getAvailableDependencies(taskId) { return tasks.filter(t => t.id !== taskId && !wouldCreateCycle(taskId, t.id)); }
function getBlockedTasks(taskId) { return tasks.filter(t => getDependsOnArray(t).includes(taskId)); }
function getStartBlockedTasks(taskId) { return tasks.filter(t => getStartDependsOnArray(t).includes(taskId)); }

// GANTT-06: Propagation des dates aux tâches dépendantes
function propagateDependencyDates(changedTaskId, visited = new Set()) {
    if (visited.has(changedTaskId)) return []; // Protection contre les cycles
    visited.add(changedTaskId);

    const changedTask = tasks.find(t => t.id === changedTaskId);
    if (!changedTask) return [];

    const changedEnd = gristToDate(changedTask.dateEcheance);
    const changedStart = gristToDate(changedTask.dateDebut);
    if (!changedEnd) return [];

    const updates = [];
    // Les deux types de lien contraignent le début du successeur, à des dates différentes : le
    // lendemain de la fin du prédécesseur pour un fin→début, son début même pour un début→début.
    const contraintes = getBlockedTasks(changedTaskId).map(t => ({ tache: t, minimum: addDays(changedEnd, 1) }));
    if (changedStart) {
        for (const t of getStartBlockedTasks(changedTaskId)) contraintes.push({ tache: t, minimum: changedStart });
    }

    contraintes.forEach(({ tache: depTask, minimum: requiredStart }) => {
        const depStart = gristToDate(depTask.dateDebut);
        const depEnd = gristToDate(depTask.dateEcheance);

        if (!depStart || !depEnd) return;

        if (depStart < requiredStart) {
            const duration = getDaysDiff(depStart, depEnd);
            const newStart = requiredStart;
            const newEnd = addDays(newStart, duration);

            // Mettre à jour en mémoire
            depTask.dateDebut = dateToGrist(newStart);
            depTask.dateEcheance = dateToGrist(newEnd);

            updates.push({
                id: depTask.id,
                dateDebut: depTask.dateDebut,
                dateEcheance: depTask.dateEcheance
            });

            // Propager récursivement
            const cascadeUpdates = propagateDependencyDates(depTask.id, visited);
            updates.push(...cascadeUpdates);
        }
    });

    // Une tâche liée deux fois au même prédécesseur, en fin→début et en début→début, est décalée
    // deux fois : ne garder que le dernier report évite de la compter deux fois dans le message.
    const parTache = new Map();
    for (const u of updates) parTache.set(u.id, u);
    return Array.from(parTache.values());
}

// ═══════════════════════════════════════════════════════════════════════
// DATE CALCULATIONS
// ═══════════════════════════════════════════════════════════════════════
function getStartOfWeek(d) { const r = new Date(d); const day = r.getDay(); r.setDate(r.getDate() - day + (day === 0 ? -6 : 1)); r.setHours(0, 0, 0, 0); return r; }
function getStartOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function getStartOfQuarter(d) { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); }
function getStartOfSemester(d) { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 6) * 6, 1); }
function getStartOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
function getWeekNumber(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const year = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil((((t - year) / 86400000) + 1) / 7); }
// Trimestre et semestre sont des fenêtres glissantes ancrées sur le mois courant, pas sur
// le trimestre ou le semestre calendaire : sur un écran large la plage entière tient sans
// défilement, et seule la date de début peut alors amener la ligne du jour près du bord.
function getViewStartDate() {
    switch (currentView) {
        case 'week': return getStartOfWeek(viewStartDate);
        case 'year': return getStartOfYear(viewStartDate);
        default: return getStartOfMonth(viewStartDate);
    }
}
function getTotalDays() { 
    const cfg = VIEW_CONFIG[currentView]; 
    if (cfg.unit === 'day') return cfg.days; 
    if (cfg.unit === 'week') return cfg.weeks * 7; 
    if (cfg.unit === 'month') return cfg.months * 30; // Approximation pour vue année
    return cfg.days; 
}
function getPixelsPerDay() { 
    const cfg = VIEW_CONFIG[currentView]; 
    if (cfg.unit === 'day') return cfg.cellWidth; 
    if (cfg.unit === 'week') return cfg.cellWidth / 7; 
    if (cfg.unit === 'month') return cfg.cellWidth / 30; // Approximation pour vue année
    return cfg.cellWidth; 
}

// ═══════════════════════════════════════════════════════════════════════
// VIEW & NAVIGATION
// ═══════════════════════════════════════════════════════════════════════
function setView(view) {
    currentView = view;
    document.querySelectorAll('.view-controls .btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    document.documentElement.style.setProperty('--cell-width', VIEW_CONFIG[view].cellWidth + 'px');
    ganttNowAligned = false;
    render();
}
function navigate(dir) {
    const cfg = VIEW_CONFIG[currentView];
    if (typeof cfg.navStep === 'number') viewStartDate = addDays(viewStartDate, dir * cfg.navStep);
    // Mois, trimestre et semestre glissent d'un mois : la fenêtre étant ancrée sur un mois,
    // sauter sa largeur entière ferait perdre le contexte affiché.
    else if (cfg.navStep === 'month' || cfg.navStep === 'quarter' || cfg.navStep === 'semester') viewStartDate = new Date(viewStartDate.getFullYear(), viewStartDate.getMonth() + dir, 1);
    else if (cfg.navStep === 'year') viewStartDate = new Date(viewStartDate.getFullYear() + dir, 0, 1);
    ganttNowAligned = false;
    render();
}
function goToToday() { viewStartDate = new Date(); ganttNowAligned = false; render(); }

function fitToTasks() {
    const ft = getFilteredTasks();
    if (ft.length === 0) { goToToday(); return; }

    // Find min/max dates from tasks
    let minDate = null, maxDate = null;
    ft.forEach(t => {
        const start = gristToDate(t.dateDebut);
        const end = gristToDate(t.dateEcheance);
        if (start && (!minDate || start < minDate)) minDate = start;
        if (end && (!maxDate || end > maxDate)) maxDate = end;
    });

    if (!minDate || !maxDate) { goToToday(); return; }

    // Add some padding (7 days before, 7 days after)
    minDate = addDays(minDate, -7);
    maxDate = addDays(maxDate, 7);

    // Calculate span in days
    const spanDays = getDaysDiff(minDate, maxDate);

    // Choose best view based on span
    if (spanDays <= 14) {
        currentView = 'week';
    } else if (spanDays <= 60) {
        currentView = 'month';
    } else if (spanDays <= 120) {
        currentView = 'quarter';
    } else if (spanDays <= 200) {
        currentView = 'semester';
    } else {
        currentView = 'year';
    }

    viewStartDate = minDate;
    document.querySelectorAll('.view-controls .btn').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
    document.documentElement.style.setProperty('--cell-width', VIEW_CONFIG[currentView].cellWidth + 'px');
    render();
}
function updatePeriodLabel() {
    const start = getViewStartDate();
    let text = '';
    switch (currentView) {
        case 'week': text = 'S' + getWeekNumber(start) + ' · ' + formatDateShort(start) + ' - ' + formatDateShort(addDays(start, 6)); break;
        case 'month': text = MONTHS[start.getMonth()] + ' ' + start.getFullYear(); break;
        case 'quarter':
        case 'semester': {
            // Fenêtre glissante : le libellé donne la plage couverte, pas un rang calendaire.
            const fin = new Date(start.getFullYear(), start.getMonth() + VIEW_CONFIG[currentView].glissante - 1, 1);
            text = MONTHS_SHORT[start.getMonth()] + ' ' + start.getFullYear() + ' - ' + MONTHS_SHORT[fin.getMonth()] + ' ' + fin.getFullYear();
            break;
        }
        case 'year': text = start.getFullYear().toString(); break;
    }
    document.getElementById('currentPeriod').textContent = text;
}

// ═══════════════════════════════════════════════════════════════════════
// SORTING & FILTERING
// ═══════════════════════════════════════════════════════════════════════
function changeSortMode(mode) {
    sortMode = mode;
    sortTasks(); render();
}
function changeColorMode(mode) {
    colorMode = mode;
    render();
}

// Demande métier : une ligne peut prendre la couleur de son responsable, lue sur son enregistrement
// dans les effectifs. Le mode n'a rien à colorer sur un document sans cette colonne, il n'y est donc
// pas proposé.
// Le défaut reste le projet : sur le document du métier, le responsable n'est renseigné que sur une
// poignée de lignes, et colorer par responsable rendrait le Gantt presque entièrement gris. Basculer
// le défaut quand la colonne sera remplie.
function entretenirOptionResponsable() {
    const disponible = TASK_COLS.has('Responsable');
    const select = document.getElementById('colorSelect');
    const option = select && select.querySelector('option[value="responsable"]');
    if (!disponible) {
        if (option) option.remove();
        if (colorMode === 'responsable') colorMode = 'project';
        if (select) select.value = colorMode;
    }
}
// Édite la couleur d'un projet (lue par tous les widgets TaskFlow via getProjectColor)
async function setProjectColor(projectId, color) {
    const p = projects.find(x => x.id === projectId);
    if (!p) return;
    p.couleur = color;
    if (gristReady) {
        try { await grist.docApi.applyUserActions([['UpdateRecord', 'Projects', projectId, { couleur: color }]]); showSaveIndicator(); }
        catch (e) { showToast('Erreur couleur projet', 'error'); }
    }
    renderPanel(); render();
}
// Édite la couleur d'un membre Team (pattern Kanban A15)
async function setMemberColor(memberId, color) {
    const m = team.find(x => x.id === memberId);
    if (!m) return;
    m.couleur = color;
    if (gristReady) {
        try { await grist.docApi.applyUserActions([['UpdateRecord', 'Team', memberId, { couleur: color }]]); showSaveIndicator(); }
        catch (e) { showToast('Erreur couleur membre', 'error'); }
    }
    renderPanel(); render();
}
function sortTasks() {
    if (sortMode === 'priority') tasks.sort((a, b) => { const pa = getTaskPriority(a), pb = getTaskPriority(b); return pa !== pb ? pa - pb : dateDeTri(a) - dateDeTri(b); });
    else if (sortMode === 'date') tasks.sort((a, b) => dateDeTri(a) - dateDeTri(b));
}
function toggleFilterMenu(id) { const m = document.querySelector('#' + id + ' .filter-menu'); const open = m.classList.contains('open'); document.querySelectorAll('.filter-menu').forEach(x => x.classList.remove('open')); if (!open) m.classList.add('open'); }
// GEN-02: Gestion des filtres avec arrays et synchronisation
// Le menu est redessine a chaque bascule : l'etat des cases venait sinon du seul clic natif sur la
// case, et cliquer le libelle posait le filtre sans cocher.
function toggleFilter(key, val) { 
    const arr = filters[key]; 
    const idx = arr.indexOf(val);
    if (idx === -1) arr.push(val);
    else arr.splice(idx, 1);
    synchroniserCochesFiltres();
    updateFilterUI();
    broadcastFilters();
    persistFilters();
    render();
}
function clearFilter(key) { filters[key] = []; synchroniserCochesFiltres(); updateFilterUI(); broadcastFilters(); persistFilters(); render(); }
function broadcastFilters() {
    if (gristReady && typeof grist !== 'undefined' && grist.setOption) {
        try { grist.setOption('filters', { project: filters.project, priority: filters.priority, assignee: filters.assignee, domaine: filters.domaine }); } 
        catch (e) { console.log('setOption not available'); }
    }
}
function updateFilterMenus() {
    const grp = (label, html, first) => '<div class="fm-group-label'+(first?' first':'')+'">'+label+'</div>'+html;
    const projHtml = projects.length ? projects.map(p => `<div class="filter-option" data-filtre="project" data-valeur="${p.id}" onclick="toggleFilter('project', ${p.id})"><input type="checkbox" ${filters.project.includes(p.id)?'checked':''}><span class="dot" style="background:${p.couleur||'#6366f1'}"></span>${escapeHtml(p.nom)}</div>`).join('') : '<div class="filter-option muted">Aucun projet</div>';
    const prioHtml = [1,2,3,4].map(p => `<div class="filter-option" data-filtre="priority" data-valeur="${p}" onclick="toggleFilter('priority', ${p})"><input type="checkbox" ${filters.priority.includes(p)?'checked':''}><span class="dot" style="background:${PRIORITY_COLORS[p]}"></span>${PRIORITY_LABELS[p]}</div>`).join('');
    const team2 = team.filter(m => m.actif !== false);
    const assHtml = team2.length ? team2.map(m => `<div class="filter-option" data-filtre="assignee" data-valeur="${m.id}" onclick="toggleFilter('assignee', ${m.id})"><input type="checkbox" ${filters.assignee.includes(m.id)?'checked':''}>${escapeHtml(m.nom)}</div>`).join('') : '<div class="filter-option muted">Aucun membre</div>';
    const domaines = domainesConnus();
    const domHtml = domaines.map((d, rang) => `<div class="filter-option" data-filtre="domaine" data-valeur="${escapeHtml(d)}" onclick="basculerDomaine(${rang})"><input type="checkbox" ${filters.domaine.includes(d)?'checked':''}>${escapeHtml(d)}</div>`).join('');
    const total = filters.project.length + filters.priority.length + filters.assignee.length + filters.domaine.length;
    const menu = document.getElementById('filterAllMenu');
    if (menu) menu.innerHTML = grp('Projets', projHtml, true) + grp('Priorités', prioHtml) + grp('Assignés', assHtml) + (domaines.length ? grp('Domaines', domHtml) : '') + '<div class="fm-foot"><span class="fm-clear" onclick="clearAllGanttFilters()">Tout effacer</span></div>';
    synchroniserCochesFiltres();
    updateFilterUI();
}

// Reconstruire le menu pendant la propagation du clic detache l'element vise, et le listener qui
// ferme les menus ne le retrouve plus dans un .filter-dropdown : il referme tout. On remet donc
// seulement les cases et le pied en phase avec les filtres.
function synchroniserCochesFiltres() {
    document.querySelectorAll('#filterAllMenu .filter-option[data-filtre]').forEach(opt => {
        const cle = opt.dataset.filtre;
        const valeur = cle === 'domaine' ? opt.dataset.valeur : Number(opt.dataset.valeur);
        const coche = opt.querySelector('input[type="checkbox"]');
        if (coche) coche.checked = filters[cle].includes(valeur);
    });
    const pied = document.querySelector('#filterAllMenu .fm-foot');
    const actifs = filters.project.length + filters.priority.length + filters.assignee.length + filters.domaine.length;
    if (pied) pied.style.display = actifs ? '' : 'none';
}

function updateFilterUI() {
    const eff = effectiveFilters();
    const total = eff.project.length + eff.priority.length + eff.assignee.length + eff.domaine.length;
    const cnt = document.getElementById('filterCount'); if (cnt) { cnt.textContent = total; cnt.style.display = total ? 'inline-flex' : 'none'; }
    const fbtn = document.querySelector('#filterGantt .filter-btn'); if (fbtn) fbtn.classList.toggle('has-filter', total > 0);
    renderFilterChips();
}
function renderFilterChips() {
    const bar = document.getElementById('filterChips'); if (!bar) return;
    const X = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    const chip = (key, val, label, color) => { const dot = color ? `<span class="fc-dot" style="background:${color}"></span>` : ''; return `<span class="fc-chip">${dot}${label}<span class="fc-x" title="Retirer" onclick="toggleFilter('${key}', ${val})">${X}</span></span>`; };
    const eff = effectiveFilters();
    const chips = [];
    eff.project.forEach(id => { const p = projects.find(x=>x.id===id); chips.push(chip('project', id, p?escapeHtml(p.nom):'Projet', p&&p.couleur)); });
    eff.priority.forEach(v => chips.push(chip('priority', v, PRIORITY_LABELS[v], PRIORITY_COLORS[v])));
    eff.assignee.forEach(id => { const m = team.find(x=>x.id===id); chips.push(chip('assignee', id, m?escapeHtml(m.nom):'Membre')); });
    eff.domaine.forEach(d => { const rang = domainesConnus().indexOf(d); chips.push(`<span class="fc-chip">${escapeHtml(d)}<span class="fc-x" title="Retirer" onclick="basculerDomaine(${rang})">${X}</span></span>`); });
    if (!chips.length) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '<span class="fc-label">Filtres actifs</span>' + chips.join('') + '<span class="fc-clear-all" onclick="clearAllGanttFilters()">Tout effacer</span>';
}
        function taskMatchesFilters(t, f) {
    f = f || effectiveFilters();
    if (f.project.length && !f.project.includes(t.projet)) return false;
    if (f.assignee.length && !getAssigneesArray(t).some(a => f.assignee.includes(a))) return false;
    if (f.priority.length && !f.priority.includes(getTaskPriority(t))) return false;
    if (f.domaine.length && !domainesDeLigne(t).some(d => f.domaine.includes(d))) return false;
    return true;
}

// Les colonnes qui désignent une personne ne sont pas connues d'avance : la structure appartient au
// métier, qui pose les siennes (sponsor, contributeurs clés). On les reconnaît à leur type, comme le
// rattachement au chantier, plutôt que d'en figer la liste.
function colonnesVersTeam(tableId) {
    const t = schemaMeta && (schemaMeta.tables || []).find(x => x.tableId === tableId);
    if (!t) return [];
    return (schemaMeta.cols || [])
        .filter(c => c.parentId === t.id && (c.type === 'Ref:Team' || c.type === 'RefList:Team'))
        .map(c => c.colId);
}
function personnesDe(rec, tableId) {
    const ids = [];
    if (!rec) return ids;
    for (const col of colonnesVersTeam(tableId)) {
        const v = rec[col];
        if (Array.isArray(v)) ids.push(...getRefListArray(v));
        else if (v) ids.push(v);
    }
    return ids;
}
// Une ligne chantier a été remise à plat par chantierEnLigne : ses colonnes de personnes y sont
// arrivées sous les noms du volet.
const personnesDeChantier = (c) => (c && c.Responsable ? [c.Responsable] : []).concat(getAssigneesArray(c));

// Une ligne appartient à tous les domaines qui la touchent : les siens, ceux de son chantier, ceux
// de son projet. Un directeur de domaine veut voir ce qui occupe son équipe, pas seulement ce
// qu'elle pilote.
function domainesDeLigne(t) {
    const ids = estChantier(t) ? personnesDeChantier(t) : personnesDe(t, 'Tasks');
    if (!estChantier(t) && t.chantier) {
        const c = tasks.find(x => estChantier(x) && x.idChantier === t.chantier);
        if (c) ids.push(...personnesDeChantier(c));
    }
    ids.push(...personnesDe(projects.find(p => p.id === t.projet), 'Projects'));
    const domaines = [];
    for (const id of ids) {
        const m = team.find(x => x.id === id);
        if (m && m.Domaine && !domaines.includes(m.Domaine)) domaines.push(m.Domaine);
    }
    return domaines;
}
function getFilteredTasks() { const f = effectiveFilters(); return tasks.filter(t => taskMatchesFilters(t, f)); }

// ═══════════════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════
function render() {
    // Un rendu demande pendant un clic ou un glisser en cours est reporte au
    // relachement (voir les ecouteurs mousedown/mouseup plus bas).
    if (gesteSourisEnCours) { renduEnAttente = true; return; }
    updatePeriodLabel();
    computeEffectiveRange();
    renderTimelineHeader();
    renderTaskList();
    renderTimeline();
    syncScroll();
    updateGanttOverlay();
}

function renderGanttSkeleton() {
    const ov = document.getElementById("ganttOverlay"); if (!ov) return;
    const sk = (w,h) => '<span class="tf-sk" style="display:block;width:'+w+';height:'+h+'px"></span>';
    const bars = [["30%",8],["42%",30],["26%",20],["18%",46],["34%",6],["24%",16]];
    let rows = "";
    for (let i=0;i<6;i++){ const w=bars[i][0], left=bars[i][1];
        rows += '<div class="tf-grow"><div class="lbl">'+sk("70%",10)+sk("45%",8)+'</div><div class="track"><span class="tf-sk" style="display:block;height:18px;border-radius:9px;margin-left:'+left+'%;width:'+w+'"></span></div></div>'; }
    ov.innerHTML = '<div class="tf-gskel">'+rows+'</div>';
    ov.style.display = "flex";
}
function clearAllGanttFilters() { filters = { project: [], assignee: [], priority: [], domaine: [] }; synchroniserCochesFiltres(); updateFilterUI(); broadcastFilters(); persistFilters(); render(); }
function updateGanttOverlay() {
    const ov = document.getElementById("ganttOverlay"); if (!ov) return;
    if (currentVisible && currentVisible.length > 0) { ov.style.display = "none"; ov.innerHTML = ""; return; }
    const eff = effectiveFilters();
    const hasFilters = eff.project.length || eff.assignee.length || eff.priority.length;
    const gicon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
    const search = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    let html;
    if (hasFilters) {
        html = '<div class="tf-empty"><span class="tf-empty-glyph">'+search+'</span><div class="tf-empty-title">Aucune tâche ne correspond</div><div class="tf-empty-sub">Aucune tâche planifiée ne passe les filtres actifs.</div><button class="tf-empty-btn" onclick="clearAllGanttFilters()">Effacer les filtres</button></div>';
    } else {
        html = '<div class="tf-empty"><span class="tf-empty-glyph">'+gicon+'</span><div class="tf-empty-title">Aucune tâche à planifier</div><div class="tf-empty-sub">Créez une première tâche avec des dates pour la voir apparaître sur la timeline.</div><button class="tf-empty-btn primary" onclick="openCreatePanel()"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nouvelle tâche</button></div>';
    }
    ov.innerHTML = html; ov.style.display = "flex";
}

// Calcule la plage effective = période vue étendue uniquement pour les tâches qui la chevauchent.
// Le calcul pur est dans TF.computeTimelineScale (partagé avec le Gantt de fiche) ; ici on applique état + DOM.
function computeEffectiveRange() {
    const cfg = VIEW_CONFIG[currentView];
    const timelineEl = document.getElementById('timelineScroll');
    const availableWidth = (timelineEl && timelineEl.clientWidth > 10) ? timelineEl.clientWidth : 600;
    const scale = TF.computeTimelineScale({
        tasks: getFilteredTasks().map(t => ({ start: gristToDate(t.dateDebut), end: gristToDate(t.dateEcheance) })),
        unit: cfg.unit, cellWidth: cfg.cellWidth,
        viewStart: getViewStartDate(), viewDays: getTotalDays(),
        availableWidth: availableWidth,
        extendLeft: !cfg.glissante
    });
    effectiveStart = scale.effectiveStart;
    effectiveDays = scale.effectiveDays;
    effectiveCellWidth = scale.cellWidth;
    effectivePxPerDay = scale.pxPerDay;
    document.documentElement.style.setProperty('--cell-width', effectiveCellWidth + 'px');
}

// Le mois s'écrit en toutes lettres quand sa case peut l'accueillir, et s'abrège sinon. Sept
// pixels par caractère à la taille de l'en-tête, plus une marge pour les bordures.
function libelleDeMois(mois, largeur) {
    const complet = MONTHS[mois];
    return largeur >= complet.length * 7 + 12 ? complet : MONTHS_SHORT[mois];
}

// Abscisse du début de la sur-colonne d'en-tête qui contient aujourd'hui. Elle ne suit le
// calendrier qu'en vues Semaine, Mois et Année ; en Trimestre et Semestre l'en-tête regroupe des
// blocs de sept jours comptés depuis le début de la plage et rattache chaque bloc au mois de son
// premier jour. Viser le 1er du mois y calait au milieu d'une sur-colonne dès que ce jour-là
// tombait en cours de semaine.
function debutSurColonneDuJour(start, todayOffset, pxPerDay) {
    const today = addDays(start, todayOffset);
    const unit = VIEW_CONFIG[currentView].unit;
    if (unit === 'month') return getDaysDiff(start, new Date(today.getFullYear(), 0, 1)) * pxPerDay;
    if (unit !== 'week') return getDaysDiff(start, new Date(today.getFullYear(), today.getMonth(), 1)) * pxPerDay;
    // L'en-tête empile une cellule de largeur fixe par bloc : compter en jours dérive de sa
    // position, la plage ne comptant pas un nombre entier de semaines.
    const moisDuBloc = (i) => { const d = addDays(start, i * 7); return d.getFullYear() * 100 + d.getMonth(); };
    let bloc = Math.floor(todayOffset / 7);
    const mois = moisDuBloc(bloc);
    while (bloc > 0 && moisDuBloc(bloc - 1) === mois) bloc--;
    return bloc * effectiveCellWidth;
}

function renderTimelineHeader() {
    const start = effectiveStart;
    const totalDays = effectiveDays;
    const cfg = VIEW_CONFIG[currentView];
    let monthsHtml = '', daysHtml = '';

    if (cfg.unit === 'month') {
        // Vue Année : itérer sur les mois réels de la plage effective
        const effEnd = addDays(start, totalDays);
        let cur = new Date(start.getFullYear(), start.getMonth(), 1);
        let idx = 0;
        while (cur < effEnd) {
            const m = cur.getMonth();
            const y = cur.getFullYear();
            const isCurrentMonth = (new Date().getMonth() === m && new Date().getFullYear() === y);
            monthsHtml += '<div class="month-cell" style="width:' + effectiveCellWidth + 'px">' + (m === 0 || idx === 0 ? y : '') + '</div>';
            daysHtml += '<div class="day-cell ' + (isCurrentMonth ? 'today' : '') + '" style="width:' + effectiveCellWidth + 'px">' + MONTHS_SHORT[m] + '</div>';
            cur = new Date(y, m + 1, 1);
            idx++;
        }

    } else if (cfg.unit === 'week') {
        // Vues Trimestre/Semestre : regrouper les cellules-semaine par mois
        // → largeur header mois = nb_cellules × effectiveCellWidth (alignement parfait)
        const weekGroups = [];
        let curGroup = null;
        for (let i = 0; i < totalDays; i += 7) {
            const d = addDays(start, i);
            const monthKey = d.getFullYear() * 100 + d.getMonth();
            if (!curGroup || curGroup.key !== monthKey) {
                curGroup = { key: monthKey, month: d.getMonth(), year: d.getFullYear(), cells: 0 };
                weekGroups.push(curGroup);
            }
            curGroup.cells++;
        }
        weekGroups.forEach((g, gi) => {
            const w = g.cells * effectiveCellWidth;
            const nom = libelleDeMois(g.month, w - (g.month === 0 || gi === 0 ? 44 : 0));
            const label = (g.month === 0 || gi === 0) ? g.year + ' · ' + nom : nom;
            monthsHtml += '<div class="month-cell" style="width:' + w + 'px">' + label + '</div>';
        });
        // Une cellule-jour par bloc de 7 jours, centrée sur le lundi ISO
        for (let i = 0; i < totalDays; i += 7) {
            let labelDate = null;
            for (let j = 0; j < 7; j++) {
                const d = addDays(start, i + j);
                if (d.getDay() === 1) { labelDate = d; break; }
            }
            if (!labelDate) labelDate = addDays(start, i);
            const isCurrentWeek = new Date() >= addDays(start, i) && new Date() < addDays(start, i + 7);
            daysHtml += '<div class="day-cell ' + (isCurrentWeek ? 'today' : '') + '" style="width:' + effectiveCellWidth + 'px">S' + getWeekNumber(labelDate) + '</div>';
        }

    } else {
        // Vues Semaine/Mois : une cellule par jour — largeur explicite alignée sur les cellules-mois
        let currentMonth = -1, monthStartIdx = 0;
        for (let i = 0; i < totalDays; i++) {
            const d = addDays(start, i);
            const m = d.getMonth();
            if (m !== currentMonth) {
                if (currentMonth !== -1) {
                    monthsHtml += '<div class="month-cell" style="width:' + ((i - monthStartIdx) * effectiveCellWidth) + 'px">' + MONTHS_SHORT[currentMonth] + '</div>';
                }
                currentMonth = m;
                monthStartIdx = i;
            }
            const isWe = isWeekend(d);
            const isT = isSameDay(d, new Date());
            const isMonthStart = d.getDate() === 1;
            daysHtml += '<div class="day-cell ' + (isWe ? 'weekend ' : '') + (isT ? 'today ' : '') + (isMonthStart ? 'month-start' : '') + '" style="width:' + effectiveCellWidth + 'px">' + d.getDate() + '</div>';
        }
        monthsHtml += '<div class="month-cell" style="width:' + ((totalDays - monthStartIdx) * effectiveCellWidth) + 'px">' + MONTHS_SHORT[currentMonth] + '</div>';
    }

    document.getElementById('monthsHeader').innerHTML = monthsHtml;
    document.getElementById('daysHeader').innerHTML = daysHtml;
}

// WBS-02: liste aplatie visible, partagée entre renderTaskList et renderTimeline
let currentVisible = [];
function renderTaskList() {
    currentVisible = buildVisibleTasks();
    panelState.taskList = currentVisible.filter(v => v.task).map(v => v.task);
    // Le compteur annonce des tâches : ni les bandeaux de projet ni les chantiers n'en sont.
    document.getElementById('taskCount').textContent = panelState.taskList.filter(t => !estChantier(t)).length;
    const collapseBtn = document.getElementById('collapseAllBtn');
    if (collapseBtn) collapseBtn.style.display = tasks.some(t => hasChildren(t) && expandedTasks.has(t.id)) ? 'inline-flex' : 'none';

    let html = '';
    currentVisible.forEach(({ task: t, depth, dimmed, groupe }) => {
        if (groupe) {
            html += '<div class="groupe-projet' + (groupe.replie ? ' replie' : '') + '" data-projet="' + groupe.id + '"' +
                ' style="background-image:' + aplatDeTeinte(groupe.couleur, 0.2) + '">' +
                '<span class="groupe-chevron" onclick="event.stopPropagation();toggleGroupeProjet(' + groupe.id + ')" title="' + (groupe.replie ? 'Déplier' : 'Replier') + '">▼</span>' +
                (groupe.categorie ? '<span class="groupe-badge">' + escapeHtml(groupe.categorie) + '</span>' : '') +
                '<span class="groupe-nom">' + escapeHtml(groupe.nom) + '</span>' +
            '</div>';
            return;
        }
        const p = getTaskPriority(t);
        const isParent = hasChildren(t);
        // Dates affichées : agrégées si parent sans dates propres, sinon dates du parent
        let start = gristToDate(t.dateDebut), end = gristToDate(t.dateEcheance);
        if (isParent && !start && !end) { const agg = aggregateDates(t); start = gristToDate(agg.start); end = gristToDate(agg.end); }
        const jalon = isJalon(t);
        const progress = isParent ? aggregateProgress(t) : (t.progression || 0);
        const selected = t.id === selectedTaskId;
        const assignees = getAssigneesArray(t);
        const avatarsHtml = pastillesDeLigne(t, assignees);
        const subs = getSubtasks(t);
        const subsDone = subs.filter(s => s.done).length;
        const subBadge = subs.length ? '<span class="task-subtask-badge' + (subsDone === subs.length ? ' complete' : '') + '" title="Sous-tâches">◎ ' + subsDone + '/' + subs.length + '</span>' : '';
        const nChildren = getChildren(t.id).length;
        const childBadge = nChildren ? '<span class="task-subtask-badge" title="Sous-tâches structurelles">↳ ' + nChildren + '</span>' : '';

        const chevron = isParent
            ? '<span class="tree-chevron' + (expandedTasks.has(t.id) ? ' expanded' : '') + '" onclick="event.stopPropagation();toggleExpand(' + t.id + ')" title="' + (expandedTasks.has(t.id) ? 'Replier' : 'Déplier') + '">▶</span>'
            : '<span class="tree-chevron-placeholder"></span>';
        const indent = depth * 18;
        const classes = ['task-row', selected ? 'selected' : '', dimmed ? 'dimmed' : '', isParent ? 'parent' : ''].filter(Boolean).join(' ');

        html += '<div class="' + classes + '" data-id="' + t.id + '" data-projet="' + (t.projet || 0) + '" data-depth="' + depth + '" onclick="openTaskPanel(' + t.id + ')" style="padding-left:' + (12 + indent) + 'px">' +
            (sortMode === 'manual' ? '<span class="drag-handle">☰</span>' : '') +
            chevron +
            '<div class="task-info">' +
                '<div class="task-name">' + (jalon ? '◆ ' : '') + (escapeHtml(t.titre) || 'Sans titre') + '</div>' +
                '<div class="task-meta">' +
                    '<span class="task-dates">' + formatDateShort(start) + ' → ' + formatDateShort(end) + '</span>' +
                    (!jalon && estChantier(t) ? '<span class="task-progress-badge">' + progress + '%</span>' : '') +
                    (estChantier(t) ? subBadge + childBadge : '') +
                    avatarsHtml +
                '</div>' +
            '</div>' +
        '</div>';
    });
    document.getElementById('taskList').innerHTML = html;

    // Même bulle de survol que sur les barres : la colonne de gauche tronque les libellés, et
    // c'est souvent là que l'on cherche le détail. Les bandeaux de projet n'en portent pas.
    for (const entree of currentVisible) {
        if (!entree.task) continue;
        const ligne = document.querySelector('#taskList .task-row[data-id="' + entree.task.id + '"]');
        if (ligne) setupTooltip(ligne, entree.task);
    }

    // Sortable en mode manuel : autorisé uniquement au sein d'une fratrie (limite via check dans onEnd)
    if (sortMode === 'manual') {
        if (sortableInstance) sortableInstance.destroy();
        sortableInstance = new Sortable(document.getElementById('taskList'), {
            animation: 150, handle: '.drag-handle', ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
            onEnd: (evt) => {
                const id = parseInt(evt.item.dataset.id);
                const movedTask = tasks.find(t => t.id === id);
                if (!movedTask) return;
                // Vérifier que le voisin visuel est dans la même fratrie, sinon annuler
                const newSiblingId = parseInt(evt.item.nextElementSibling?.dataset.id || evt.item.previousElementSibling?.dataset.id);
                const sibling = tasks.find(t => t.id === newSiblingId);
                if (sibling && (sibling.parentTask || null) !== (movedTask.parentTask || null)) {
                    showToast('Le drag manuel est limité à la même fratrie', 'info');
                    render();
                    return;
                }
                const newIndex = evt.newIndex, oldIndex = evt.oldIndex;
                if (newIndex !== oldIndex) {
                    const [moved] = tasks.splice(tasks.findIndex(t => t.id === id), 1);
                    tasks.splice(newIndex, 0, moved);
                    render();
                }
            }
        });
    }
}

function renderTimeline() {
    // WBS-02: utiliser currentVisible (ordre DFS) au lieu d'une liste plate filtrée
    const ft = currentVisible.map(v => v.task);
    const dimmedSet = new Set(currentVisible.filter(v => v.dimmed).map(v => v.task.id));
    const start = effectiveStart;
    const totalDays = effectiveDays;
    const cfg = VIEW_CONFIG[currentView];

    // Largeur totale depuis effectiveCellWidth (calculé dans computeEffectiveRange)
    let numCells, totalWidth;
    if (cfg.unit === 'month') {
        const effEnd = addDays(start, totalDays);
        numCells = Math.max(1, (effEnd.getFullYear() - start.getFullYear()) * 12 + (effEnd.getMonth() - start.getMonth()));
        totalWidth = numCells * effectiveCellWidth;
    } else if (cfg.unit === 'week') {
        numCells = Math.ceil(totalDays / 7);
        totalWidth = numCells * effectiveCellWidth;
    } else {
        numCells = totalDays;
        totalWidth = numCells * effectiveCellWidth;
    }
    // pxPerDay = effectivePxPerDay (déjà calculé depuis effectiveCellWidth)
    const pxPerDay = effectivePxPerDay;

    let gridHtml = '';
    ft.forEach((_, iLigne) => {
        const groupe = currentVisible[iLigne] && currentVisible[iLigne].groupe;
        if (groupe) {
            gridHtml += '<div class="grid-row piste-groupe" style="width:' + totalWidth + 'px;background-image:' +
                aplatDeTeinte(groupe.couleur, 0.2) + '"></div>';
            return;
        }
        gridHtml += '<div class="grid-row">';
        if (cfg.unit === 'month') {
            const effEnd = addDays(start, totalDays);
            let cur = new Date(start.getFullYear(), start.getMonth(), 1);
            while (cur < effEnd) {
                const m = cur.getMonth();
                const y = cur.getFullYear();
                const isCurrentMonth = (new Date().getMonth() === m && new Date().getFullYear() === y);
                gridHtml += '<div class="grid-cell ' + (isCurrentMonth ? 'today' : '') + '" style="width:' + effectiveCellWidth + 'px"></div>';
                cur = new Date(y, m + 1, 1);
            }
        } else if (cfg.unit === 'week') {
            for (let i = 0; i < totalDays; i += 7) {
                const d = addDays(start, i);
                const isT = new Date() >= d && new Date() < addDays(d, 7);
                gridHtml += '<div class="grid-cell ' + (isT ? 'today' : '') + '" style="width:' + effectiveCellWidth + 'px"></div>';
            }
        } else {
            for (let i = 0; i < totalDays; i++) {
                const d = addDays(start, i);
                const isWe = isWeekend(d);
                const isT = isSameDay(d, new Date());
                const isMonthStart = d.getDate() === 1;
                gridHtml += '<div class="grid-cell ' + (isWe ? 'weekend ' : '') + (isT ? 'today ' : '') + (isMonthStart ? 'month-start' : '') + '" style="width:' + effectiveCellWidth + 'px"></div>';
            }
        }
        gridHtml += '</div>';
    });

    const grid = document.getElementById('timelineGrid');
    grid.innerHTML = gridHtml;
    grid.style.width = totalWidth + 'px';
    grid.style.height = (ft.length * 44) + 'px';

    // Ligne aujourd'hui. Ramenée à minuit : getDaysDiff arrondit, donc l'heure courante
    // décalait le trait d'un jour à partir de la mi-journée.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOffset = getDaysDiff(start, today);
    if (todayOffset >= 0 && todayOffset <= totalDays) {
        const todayLine = document.createElement('div');
        todayLine.className = 'today-line';
        todayLine.style.left = Math.round(todayOffset * pxPerDay) + 'px';
        grid.appendChild(todayLine);

        // Caler le début de la colonne d'en-tête du dessus contenant aujourd'hui (le mois, ou
        // l'année en vue Année) près du bord gauche, avec un léger écart. Réarmé à chaque navigation.
        if (!ganttNowAligned) {
            const sc = document.getElementById('timelineScroll');
            if (sc && sc.scrollWidth > sc.clientWidth) {
                sc.scrollLeft = TF.computeTodayScroll({
                    colPx: debutSurColonneDuJour(start, todayOffset, pxPerDay),
                    todayPx: todayOffset * pxPerDay,
                    visibleWidth: sc.clientWidth
                });
                ganttNowAligned = true;
            }
        }
    }

    // Barres et jalons — ordre Y = currentVisible (DFS avec expand/collapse)
    const barresTracees = new Set();
    ft.forEach((t, idx) => {
        if (!t) return;   // ligne de bandeau : elle occupe sa hauteur, sans barre
        const isParent = hasChildren(t);
        // Dates effectives : agrégées si parent sans dates propres, sinon dates du parent
        let tStart = gristToDate(t.dateDebut), tEnd = gristToDate(t.dateEcheance);
        if (isParent && (!tStart || !tEnd)) { const agg = aggregateDates(t); if (!tStart) tStart = gristToDate(agg.start); if (!tEnd) tEnd = gristToDate(agg.end); }
        if (!tStart || !tEnd) return;
        // Entièrement hors de la fenêtre : la barre serait réduite à son plancher de
        // largeur et collée au bord, ce qui la ferait lire comme une tâche du jour.
        if (tEnd < start || tStart > addDays(start, totalDays)) return;
        barresTracees.add(t.id);

        const p = getTaskPriority(t);
        const jalon = isJalon(t);
        const top = idx * 44 + 10;
        const geo = TF.computeBarGeometry({ start: start, tStart: tStart, tEnd: tEnd, pxPerDay: pxPerDay });
        const left = geo.left, width = geo.width;
        const selected = t.id === selectedTaskId;
        const dimmed = dimmedSet.has(t.id);

        if (left + width < -50 || left > totalWidth + 50) return;

        if (jalon) {
            const m = document.createElement('div');
            m.className = 'gantt-milestone p' + p + (selected ? ' selected' : '') + (dimmed ? ' dimmed' : '');
            m.dataset.id = t.id;
            m.style.left = geo.diamondLeft + 'px';
            m.style.top = top + 'px';
            const jColor = getTaskColor(t);
            m.innerHTML = '<div class="milestone-diamond" style="background:' + jColor + '"></div><span class="milestone-label">' + escapeHtml(t.titre) + '</span>';
            m.onclick = () => openTaskPanel(t.id);
            m.onmousedown = (e) => startDrag(e, m, 'move');
            setupTooltip(m, t);
            grid.appendChild(m);
        } else {
            const bar = document.createElement('div');
            const barLeft = geo.barLeft, barWidth = geo.barWidth, isNarrow = geo.isNarrow;
            const progVal = isParent ? aggregateProgress(t) : (t.progression || 0);
            bar.className = 'gantt-bar p' + p + (selected ? ' selected' : '') + (isNarrow ? ' narrow-bar' : '') + (isParent ? ' parent' : '') + (dimmed ? ' dimmed' : '');
            bar.dataset.id = t.id;
            bar.style.left = barLeft + 'px';
            bar.style.top = top + 'px';
            bar.style.width = barWidth + 'px';
            bar.style.background = getTaskBarGradient(t);
            bar.style.borderColor = getTaskColor(t);
            bar.innerHTML = '<div class="gantt-bar-progress" style="width:' + progVal + '%"></div>' +
                (isParent ? '' : '<div class="resize-handle left" onmousedown="startDrag(event, this.parentElement, \'resize-left\')"></div>') +
                '<span class="gantt-bar-label" style="position:relative;z-index:1;">' + escapeHtml(t.titre) + '</span>' +
                (isParent ? '' : '<div class="resize-handle right" onmousedown="startDrag(event, this.parentElement, \'resize-right\')"></div>') +
                '<span class="gantt-bar-external-label">' + escapeHtml(t.titre) + '</span>';
            // Les deux poignees de 8px couvrent toute une barre courte : ignorer le clic
            // des qu'il porte sur une poignee rendrait ces barres impossibles a ouvrir.
            bar.onclick = (e) => { if (!e.target.classList.contains('resize-handle') || !dragState.deplace) openTaskPanel(t.id); };
            bar.onmousedown = (e) => { if (!e.target.classList.contains('resize-handle')) startDrag(e, bar, 'move'); };
            setupTooltip(bar, t);
            grid.appendChild(bar);
        }
    });

    sortirLesTitresQuiDebordent(grid);
    renderDependencies(ft, start, pxPerDay, barresTracees);
}

// Un titre plus long que sa barre est reporté à côté d'elle plutôt que tronqué. La largeur de la
// barre ne suffit pas à en décider : c'est le texte qu'il faut mesurer, une fois posé. Une seule
// passe de lecture après l'écriture du DOM, pour ne provoquer qu'un recalcul de mise en page.
function sortirLesTitresQuiDebordent(grid) {
    const largeurGrille = grid.scrollWidth;
    const aSortir = [];
    for (const bar of grid.querySelectorAll('.gantt-bar:not(.parent):not(.narrow-bar)')) {
        const dedans = bar.querySelector('.gantt-bar-label');
        if (!dedans) continue;
        // 16px : les marges intérieures de la barre, que le texte ne peut pas occuper.
        if (dedans.scrollWidth <= bar.clientWidth - 16) continue;
        aSortir.push({ bar: bar, largeur: dedans.scrollWidth, fin: bar.offsetLeft + bar.offsetWidth });
    }
    for (const item of aSortir) {
        item.bar.classList.add('narrow-bar');
        // Le titre déborderait de la plage dessinée : il passe à gauche de la barre.
        if (item.fin + 6 + item.largeur > largeurGrille) item.bar.classList.add('titre-a-gauche');
    }
}

function renderDependencies(ft, start, pxPerDay, barresTracees) {
    const existing = document.querySelector('.dependencies-layer');
    if (existing) existing.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('dependencies-layer');
    svg.style.width = '100%';
    svg.style.height = '100%';

    const taskIndexMap = {};
    ft.forEach((t, i) => { if (t) taskIndexMap[t.id] = i; });

    ft.forEach(t => {
        if (!t) return;   // ligne de bandeau : pas de dependance a tracer
        const liens = getDependsOnArray(t).map(id => ({ id: id, lien: 'fin' }))
            .concat(getStartDependsOnArray(t).map(id => ({ id: id, lien: 'debut' })));
        liens.forEach(({ id: depId, lien }) => {
            const depTask = tasks.find(x => x.id === depId);
            if (!depTask || taskIndexMap[depId] === undefined) return;
            // Une flèche vers une barre non tracée partirait dans le vide.
            if (barresTracees && (!barresTracees.has(t.id) || !barresTracees.has(depId))) return;

            const depEnd = gristToDate(depTask.dateEcheance);
            const depStart = gristToDate(depTask.dateDebut);
            const tStart = gristToDate(t.dateDebut);
            if (!tStart) return;
            if (lien === 'debut' ? !depStart : !depEnd) return;

            const depIdx = taskIndexMap[depId];
            const tIdx = taskIndexMap[t.id];

            const dep = TF.computeDependencyPath({ start: start, depEnd: depEnd, depStart: depStart, tStart: tStart, depIdx: depIdx, tIdx: tIdx, pxPerDay: pxPerDay, lien: lien });
            const highlight = selectedTaskId === t.id || selectedTaskId === depId;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', dep.pathD);
            path.classList.add('dependency-line');
            if (lien === 'debut') path.classList.add('depart-debut');
            if (highlight) path.classList.add('highlight');
            svg.appendChild(path);

            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', dep.arrowPoints);
            arrow.classList.add('dependency-arrow');
            if (highlight) arrow.classList.add('highlight');
            svg.appendChild(arrow);
        });
    });

    document.getElementById('timelineGrid').appendChild(svg);
}

function setupTooltip(el, task) {
    const tooltip = document.getElementById('tooltip');
    el.addEventListener('mouseenter', () => {
        let html = '<div class="tooltip-title">' + escapeHtml(task.titre) + '</div>';
        TOOLTIP_FIELDS.forEach(field => {
            const value = field.format(task);
            if (value) html += '<div class="tooltip-row"><span>' + field.label + '</span><span>' + escapeHtml(String(value)) + '</span></div>';
        });
        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
    });
    el.addEventListener('mousemove', (e) => { tooltip.style.left = (e.clientX + 15) + 'px'; tooltip.style.top = (e.clientY + 15) + 'px'; });
    el.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
    el.addEventListener('click', () => tooltip.classList.remove('visible')); // clic = ouverture panel : masquer le tooltip
}

function syncScroll() {
    const taskList = document.getElementById('taskList');
    const timeline = document.getElementById('timelineScroll');
    const monthsHeader = document.getElementById('monthsHeader');
    const daysHeader = document.getElementById('daysHeader');

    // Appliquer immédiatement la position de scroll courante (après chaque render)
    const initX = timeline.scrollLeft;
    monthsHeader.style.transform = 'translateX(-' + initX + 'px)';
    daysHeader.style.transform = 'translateX(-' + initX + 'px)';
    taskList.scrollTop = timeline.scrollTop;

    // Sync vertical scroll between task list and timeline
    taskList.onscroll = () => timeline.scrollTop = taskList.scrollTop;

    // Sync both vertical and horizontal scroll
    timeline.onscroll = () => {
        taskList.scrollTop = timeline.scrollTop;
        // Sync horizontal scroll with headers using transform
        const scrollX = timeline.scrollLeft;
        monthsHeader.style.transform = 'translateX(-' + scrollX + 'px)';
        daysHeader.style.transform = 'translateX(-' + scrollX + 'px)';
    };
}

// ═══════════════════════════════════════════════════════════════════════
// PANEL SLIDE-IN
// ═══════════════════════════════════════════════════════════════════════
function openPanel() {
    panelState.open = true;
    const _tt = document.getElementById('tooltip'); if (_tt) _tt.classList.remove('visible'); // masque le tooltip survol quand le panel s'ouvre
    poserLargeurVolet();
    document.getElementById('panel').classList.add('open');
    document.getElementById('ganttWrapper').classList.add('panel-open');
}

// Largeurs ajustables de la colonne de gauche et du volet. Elles vivent dans des variables CSS,
// que la souris déplace et que le stockage local retient d'une ouverture à l'autre.
const LARGEURS = {
    taskList: { variable: '--task-list-width', cle: 'taskflow_gantt_largeur_liste', min: 140, partMax: 0.7 },
    panel: { variable: '--panel-width', cle: 'taskflow_gantt_largeur_volet', min: 320, partMax: 0.8 }
};

// Référence stable pour borner les largeurs. Surtout pas celle du wrapper : le volet ouvert lui
// prend une marge à droite, donc s'en servir ferait rétrécir la borne à mesure qu'on élargit.
function largeurDeLaVue() {
    return document.documentElement.clientWidth || window.innerWidth;
}

function poserLargeur(nom, px) {
    const reglage = LARGEURS[nom];
    const borne = Math.max(reglage.min, Math.min(px, largeurDeLaVue() * reglage.partMax));
    document.documentElement.style.setProperty(reglage.variable, Math.round(borne) + 'px');
    return borne;
}

// Le volet s'ouvre sur la moitié de la place restante, sauf largeur déjà choisie à la souris.
function poserLargeurVolet() {
    const retenue = parseFloat(localStorage.getItem(LARGEURS.panel.cle));
    if (retenue > 0) { poserLargeur('panel', retenue); return; }
    const liste = document.getElementById('taskList');
    const dispo = largeurDeLaVue() - (liste ? liste.getBoundingClientRect().width : 0);
    poserLargeur('panel', dispo / 2);
}

function restaurerLargeurs() {
    const retenue = parseFloat(localStorage.getItem(LARGEURS.taskList.cle));
    if (retenue > 0) poserLargeur('taskList', retenue);
}

// La poignée déplace la largeur pendant le glisser, et ne la retient qu'au relâchement. Le sens
// est inversé pour le volet, ancré à droite : tirer vers la gauche l'élargit.
function brancherPoignee(idPoignee, nom, sens) {
    const poignee = document.getElementById(idPoignee);
    if (!poignee) return;
    poignee.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const departX = e.clientX;
        const cible = nom === 'taskList' ? document.getElementById('taskList') : document.getElementById('panel');
        const departLargeur = cible.getBoundingClientRect().width;
        poignee.classList.add('active');
        let derniere = departLargeur;

        const suivre = (ev) => { derniere = poserLargeur(nom, departLargeur + sens * (ev.clientX - departX)); };
        const relacher = () => {
            document.removeEventListener('mousemove', suivre);
            document.removeEventListener('mouseup', relacher);
            poignee.classList.remove('active');
            localStorage.setItem(LARGEURS[nom].cle, String(Math.round(derniere)));
            render();
        };
        document.addEventListener('mousemove', suivre);
        document.addEventListener('mouseup', relacher);
    });
}

function closePanel() {
    // Ecrit la saisie en cours du titre ou de la description, que rien d'autre ne persiste.
    if (panelState.dirty && !panelState.isNew && gristReady) saveTaskToGrist();
    panelState.open = false;
    document.getElementById('panel').classList.remove('open');
    document.getElementById('ganttWrapper').classList.remove('panel-open');
    panelState = { open: false, isNew: false, taskId: null, taskIndex: -1, taskList: panelState.taskList, editData: null, dirty: false };
    selectedTaskId = null;
    render();
}
function confirmClosePanel() {
    if (panelState.isNew && panelState.editData?.titre?.trim()) {
        if (confirm('Fermer sans créer la tâche ?')) closePanel();
    } else { closePanel(); }
}

function openTaskPanel(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Ecrit la saisie en cours avant de basculer sur une autre tache, meme condition que closePanel.
    if (panelState.dirty && !panelState.isNew && gristReady) saveTaskToGrist();
    // L'indicateur doit repartir a faux : editData va etre remplace par celui de la nouvelle tache.
    panelState.dirty = false;

    selectedTaskId = taskId;
    const idx = panelState.taskList.findIndex(t => t.id === taskId);

    panelState.isNew = false;
    panelState.estChantier = estChantier(task);
    panelState.taskId = taskId;
    panelState.taskIndex = idx >= 0 ? idx : 0;
    panelState.editData = panelState.estChantier ? donneesChantier(task) : cloneTaskData(task);

    renderPanel();
    openPanel();
    if (gristReady) grist.setSelectedRows([taskId]);
    render();
}

function openCreatePanel() { openCreateTaskWithParent(null); }

// Créer un chantier n'a de sens que sur un document qui a leur table : sans elle, le bouton
// n'ouvre aucun choix et crée une tâche.
function ouvrirMenuAjout(e) {
    const menu = document.getElementById('menuAjout');
    if (!menu) return;
    if (!colonneChantier()) { openCreatePanel(); return; }
    if (e) e.stopPropagation();
    menu.hidden = !menu.hidden;
}

function fermerMenuAjout() {
    const menu = document.getElementById('menuAjout');
    if (menu) menu.hidden = true;
}

document.addEventListener('click', (e) => {
    const menu = document.getElementById('menuAjout');
    if (menu && !menu.hidden && !menu.contains(e.target)) fermerMenuAjout();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerMenuAjout(); });

// Tant que la fiche n'est pas enregistrée, le type reste ouvert : une tâche peut devenir chantier
// et l'inverse. Une fois enregistrée, la ligne vit dans sa table et la bascule reviendrait à la
// déplacer d'une table à l'autre, ce qui n'est pas proposé.
function pastillesDeType(data, chantier) {
    const neuve = panelState.isNew;
    const pastille = (libelle, actif, action, raison) => {
        if (actif) return '<span class="type-pill selected">' + libelle + '</span>';
        if (!neuve) return '<span class="type-pill fige" title="' + raison + '">' + libelle + '</span>';
        return '<span class="type-pill" onclick="' + action + '">' + libelle + '</span>';
    };
    const fige = 'Le type se choisit à la création';
    return pastille('Tâche', !chantier && data.type !== 'jalon', "changerTypeFiche('tache')", fige) +
        pastille('Chantier', !!chantier, "changerTypeFiche('chantier')", fige) +
        pastille('◆ Jalon', !chantier && data.type === 'jalon', "changerTypeFiche('jalon')", fige);
}

// La bascule change la table cible : on repart d'une fiche vierge du bon type, en gardant ce qui a
// déjà été saisi et qui a un sens des deux côtés.
function changerTypeFiche(cible) {
    if (!panelState.isNew) return;
    const garde = panelState.editData || {};
    const repris = { titre: garde.titre || '', description: garde.description || '', dateDebut: garde.dateDebut || null, dateEcheance: garde.dateEcheance || null, projet: garde.projet || null };
    const versChantier = cible === 'chantier';
    if (versChantier === !!panelState.estChantier) {
        if (!versChantier) updateField('type', cible);
        return;
    }
    if (versChantier) openCreateChantierPanel(); else openCreateTaskWithParent(null);
    Object.assign(panelState.editData, repris);
    if (!versChantier) panelState.editData.type = cible;
    renderPanel();
}

function choisirAjout(quoi) {
    fermerMenuAjout();
    if (quoi === 'chantier') { openCreateChantierPanel(); return; }
    openCreatePanel();
    if (quoi === 'jalon') updateField('type', 'jalon');
}

// Création d'un chantier : même volet, en mode chantier, avec les champs que le cadrage laisse.
function openCreateChantierPanel() {
    const today = new Date();
    if (panelState.dirty && !panelState.isNew && gristReady) saveTaskToGrist();
    panelState = {
        open: true, isNew: true, estChantier: true, taskId: null, taskIndex: -1,
        taskList: panelState.taskList, dirty: false,
        editData: {
            titre: '', description: '', type: 'chantier', statut: '', progression: 0, priorite: null,
            dateDebut: dateToGrist(today), dateEcheance: dateToGrist(addDays(today, 30)),
            projet: projects.length > 0 ? projects[0].id : null,
            Responsable: null,
            assignees: [], dependDe: [], dependDebutDe: [], tags: [], subtasks: [], charges: [],
            estimationH: null, tempsPasse: null, couleur: null, parentTask: null
        }
    };
    renderPanel();
    openPanel();
}

async function createChantier() {
    const data = panelState.editData;
    if (!data || !data.titre || !data.titre.trim()) { showToast('Titre requis', 'error'); return; }
    if (data.dateDebut && data.dateEcheance && data.dateDebut > data.dateEcheance) {
        showToast('La date de début ne peut pas dépasser la date de fin', 'error');
        return;
    }
    const record = {
        Nom_du_chantier: data.titre, Description: data.description || '',
        Projets: toGristRefList(data.projet ? [data.projet] : []),
        Responsable: data.Responsable || null
    };
    record[colonneDateChantier('debut')] = data.dateDebut || null;
    record[colonneDateChantier('fin')] = data.dateEcheance || null;
    try {
        await grist.docApi.applyUserActions([['AddRecord', 'Chantiers', null, pruneChantierRecord(record)]]);
        closePanel();
        await loadAllData();
    } catch (e) {
        console.error('Création du chantier refusée', e, record);
        showToast('Erreur création du chantier : ' + messageErreur(e), 'error');
    }
}
// WBS-02: création d'une sous-tâche (ou tâche racine si parentId === null)
function openCreateTaskWithParent(parentId) {
    const today = new Date();
    const parent = parentId ? tasks.find(t => t.id === parentId) : null;
    // Une tache est toujours rattachee a un chantier : si le parent en est un, c'est le
    // rattachement, pas une sous-tache.
    const chantierParent = estChantier(parent) ? parent.idChantier : (parent ? parent.chantier || null : null);
    // Ecrit la saisie en cours avant de passer en creation, meme condition que closePanel et openTaskPanel.
    if (panelState.dirty && !panelState.isNew && gristReady) saveTaskToGrist();
    panelState = {
        open: true, isNew: true, taskId: null, taskIndex: -1, taskList: panelState.taskList, dirty: false,
        editData: {
            titre: '', description: '', type: 'tache', priorite: '3', statut: 'todo', progression: 0,
            dateDebut: dateToGrist(today), dateEcheance: dateToGrist(addDays(today, 7)),
            projet: parent?.projet || (projects.length > 0 ? projects[0].id : null),
            assignees: [], dependDe: [], dependDebutDe: [], tags: [], estimationH: null, tempsPasse: null, subtasks: [],
            couleur: null, Responsable: null, parentTask: estChantier(parent) ? null : (parentId || null),
            chantier: chantierParent, charges: []
        }
    };
    renderPanel();
    openPanel();
    render();
    setTimeout(() => { const el = document.getElementById('taskTitle'); if (el) el.focus(); }, 100);
}
// WBS-02: détacher la tâche courante de son parent (devient racine)
function detachFromParent() { updateField('parentTask', null); }
// WBS-05: ajuste les dates du parent aux bornes (min/max) de ses descendants
async function adjustParentDatesToChildren() {
    const t = tasks.find(x => x.id === panelState.taskId);
    if (!t || !hasChildren(t)) return;
    const kids = getAllDescendants(t.id);
    let minS = null, maxE = null;
    for (const k of kids) {
        if (k.dateDebut != null && (minS == null || k.dateDebut < minS)) minS = k.dateDebut;
        if (k.dateEcheance != null && (maxE == null || k.dateEcheance > maxE)) maxE = k.dateEcheance;
    }
    if (minS == null || maxE == null) { showToast('Aucun descendant avec dates', 'info'); return; }
    t.dateDebut = minS; t.dateEcheance = maxE;
    if (panelState.editData) { panelState.editData.dateDebut = minS; panelState.editData.dateEcheance = maxE; }
    if (gristReady) {
        try { await grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', t.id, { dateDebut: minS, dateEcheance: maxE }]]); showSaveIndicator(); }
        catch (e) { showToast('Erreur ajustement', 'error'); }
    }
    renderPanel(); render();
}
// WBS-02: changer le parent (via dropdown de sélection)
function setParent(newParentId) {
    if (panelState.taskId && !canSetParent(panelState.taskId, newParentId)) {
        showToast('Cycle détecté — choix impossible', 'error');
        return;
    }
    updateField('parentTask', newParentId);
}

function cloneTaskData(task) {
    return {
        titre: task.titre || '', description: task.description || '', type: task.type || 'tache',
        priorite: String(task.priorite || '3'), statut: task.statut || 'todo', progression: task.progression || 0,
        dateDebut: task.dateDebut, dateEcheance: task.dateEcheance, projet: task.projet || null,
        assignees: getAssigneesArray(task), dependDe: getDependsOnArray(task),
        dependDebutDe: getStartDependsOnArray(task), tags: getTagsArray(task),
        estimationH: task.estimationH || null, tempsPasse: task.tempsPasse || null, subtasks: getSubtasks(task),
        couleur: task.couleur || null, parentTask: task.parentTask || null, chantier: task.chantier || null,
        Responsable: task.Responsable || null,
        charges: TF.parseCharges(task.charges), dateCloture: task.dateCloture || null
    };
}

// FIX: Synchroniser editData vers le task local dans tasks[]
function syncLocalTask() {
    if (panelState.isNew || !panelState.taskId) return;
    const task = tasks.find(t => t.id === panelState.taskId);
    const data = panelState.editData;
    if (!task || !data) return;
    task.titre = data.titre;
    task.description = data.description;
    task.type = data.type;
    task.priorite = data.priorite;
    task.statut = data.statut;
    task.progression = data.progression;
    task.dateDebut = data.dateDebut;
    task.dateEcheance = data.dateEcheance;
    task.projet = data.projet;
    task.assignees = ['L', ...data.assignees];
    task.Responsable = data.Responsable || null;
    task.dependDe = ['L', ...data.dependDe];
    task.dependDebutDe = ['L', ...data.dependDebutDe];
    task.tags = ['L', ...data.tags];
    task.estimationH = data.estimationH;
    task.tempsPasse = data.tempsPasse;
    task.couleur = data.couleur || null;
    task.parentTask = data.parentTask || null;
    task.charges = TF.chargesToJson((data.charges || []).filter(c => data.assignees.includes(c.teamId)));
}

function navigatePanelTask(dir) {
    if (panelState.isNew || panelState.taskList.length < 2) return;
    let newIdx = panelState.taskIndex + dir;
    if (newIdx < 0) newIdx = panelState.taskList.length - 1;
    if (newIdx >= panelState.taskList.length) newIdx = 0;
    const t = panelState.taskList[newIdx];
    if (t) openTaskPanel(t.id);
}

// Le cadrage masque plusieurs champs sur un chantier, remplace les sous-tâches par un bouton
// d'ajout, et fait remonter assignés et charges depuis les tâches. Adapter le volet après rendu
// évite de dupliquer sa construction, commune aux tâches et aux chantiers.
// Les prérequis sont retirés faute de dépendances exploitables côté Chantiers : le cadrage ne les
// mentionne pas, et les laisser ouvrirait une écriture sans destination.
function adapterVoletChantier(racine) {
    const champsMasques = ['Priorité', 'Progression', 'Parent', 'Couleur'];
    for (const row of racine.querySelectorAll('.prop-row')) {
        const label = row.querySelector('.prop-label');
        if (label && champsMasques.includes(label.textContent.trim())) row.remove();
    }

    const sectionsMasquees = ['Planning', 'Checklist', 'Prérequis'];
    for (const section of racine.querySelectorAll('.panel-section')) {
        const titre = section.querySelector('.panel-section-title');
        if (!titre) continue;
        const nom = titre.textContent.trim();
        if (sectionsMasquees.includes(nom)) { section.remove(); continue; }
        if (nom.startsWith('Sous-tâches')) titre.textContent = 'Tâches';
    }

    for (const bouton of racine.querySelectorAll('button')) {
        if (bouton.textContent.trim() === '+ Sous-tâche') bouton.textContent = '+ Ajouter une tâche';
        if (bouton.textContent.trim() === 'Supprimer la tâche') bouton.textContent = 'Supprimer le chantier';
    }

    // Assignés et charges sont des remontées des tâches : rien ne s'édite ici. Sans la mention, un
    // chantier dont les tâches n'ont personne montre un bloc vide qui passe pour une panne.
    const selecteur = racine.querySelector('#assigneesSelect');
    if (selecteur) {
        const valeur = selecteur.parentNode;
        selecteur.remove();
        const mention = document.createElement('div');
        mention.className = 'prop-hint';
        mention.textContent = 'Remontée automatique des contributeurs aux tâches';
        valeur.appendChild(mention);
    }
    racine.querySelectorAll('.asg-x').forEach(x => x.remove());
    racine.querySelectorAll('.charge-row input').forEach(i => { i.disabled = true; });
}

// Le titre s'écrit sur autant de lignes qu'il en faut : un long libellé se relit mal quand il
// file en longueur. La hauteur est remise à zéro avant mesure, sinon elle ne fait que croître.
function ajusterHauteurTitre(champ) {
    if (!champ) return;
    champ.style.height = 'auto';
    champ.style.height = champ.scrollHeight + 'px';
}

function renderPanel() {
    const header = document.getElementById('panelHeader');
    const content = document.getElementById('panelContent');
    const footer = document.getElementById('panelFooter');
    const data = panelState.editData;
    if (!data) { closePanel(); return; }
    // Volet chantier : type non modifiable, et les champs que le cadrage masque restent absents.
    const chantier = !!panelState.estChantier;

    const canNavigate = panelState.taskList.length > 1 && !panelState.isNew;
    const navLabel = !panelState.isNew && panelState.taskList.length > 1 ? (panelState.taskIndex + 1) + '/' + panelState.taskList.length : '';
    header.innerHTML = '<div class="panel-nav">' +
        '<button class="panel-nav-btn" onclick="navigatePanelTask(-1)" ' + (!canNavigate ? 'disabled' : '') + '>◀</button>' +
        (navLabel ? '<span class="panel-title">' + navLabel + '</span>' : '') +
        '<button class="panel-nav-btn" onclick="navigatePanelTask(1)" ' + (!canNavigate ? 'disabled' : '') + '>▶</button>' +
    '</div><button class="panel-close" onclick="confirmClosePanel()">×</button>';

    const s = gristToDate(data.dateDebut);
    const e = gristToDate(data.dateEcheance);
    const priorityColor = PRIORITY_COLORS[getTaskPriority(data)] || '#94a3b8';
    const currentProject = projects.find(p => p.id === data.projet);
    const projectColor = currentProject?.couleur || '#94a3b8';
    const projectOptions = projects.filter(p => p.actif !== false).map(p =>
        '<option value="' + p.id + '" ' + (data.projet === p.id ? 'selected' : '') + '>' + escapeHtml(p.nom) + '</option>'
    ).join('');
    const subtasksDone = (data.subtasks || []).filter(st => st.done).length;
    const subtasksTotal = (data.subtasks || []).length;
    const descLabel = data.type === 'reunion' ? 'Ordre du jour' : data.type === 'jalon' ? "Critères d'acceptation" : 'Description';
    const assignLabel = data.type === 'reunion' ? 'Participants' : 'Contributeurs';
    const titlePlaceholder = data.type === 'jalon' ? 'Nom du jalon...' : data.type === 'reunion' ? 'Sujet de la réunion...' : 'Titre de la tâche...';

    // Champ de recherche partagé par les sélecteurs recherchables.
    const msSearch = '<input type="text" class="multi-select-search" placeholder="Rechercher…" oninput="filterMultiSelectOptions(this)" onclick="event.stopPropagation()">';
    const msNoResult = '<div class="multi-select-noresult">Aucun résultat</div>';
    const parentOptions = tasks.filter(t => t.id !== panelState.taskId && (t.projet || null) === (data.projet || null) && canSetParent(panelState.taskId, t.id))
        .map(t => '<div class="multi-select-option" onclick="setParent(' + t.id + ')">' + escapeHtml(t.titre) + '</div>').join('');

    const assigneesChips = data.assignees.map(id =>
        '<span class="multi-select-chip">' + escapeHtml(getTeamMemberName(id)) + '<span class="remove" onclick="event.stopPropagation();removeAssignee(' + id + ')">×</span></span>'
    ).join('');
    const responsableOptions = team.filter(m => m.actif !== false).map(m =>
        '<div class="multi-select-option ' + (data.Responsable === m.id ? 'selected' : '') + '" onclick="choisirResponsable(' + m.id + ')">' +
            '<span class="member-color-dot" style="background:' + getTeamMemberColor(m.id) + '"></span>' +
            '<span>' + escapeHtml(m.nom) + '</span>' +
        '</div>').join('');
    const assigneesOptions = team.filter(m => m.actif !== false).map(m => {
        const swatches = COLOR_PRESETS.map(c => '<span class="color-swatch" style="background:' + c + '" onclick="event.stopPropagation();setMemberColor(' + m.id + ',\'' + c + '\')"></span>').join('');
        return '<div class="multi-select-option ' + (data.assignees.includes(m.id) ? 'selected' : '') + '" onclick="toggleAssignee(' + m.id + ')">' +
            '<div class="member-color-wrap">' +
                '<span class="member-color-dot" style="background:' + getTeamMemberColor(m.id) + '" title="Changer la couleur du membre" onclick="event.stopPropagation();this.nextElementSibling.classList.toggle(\'open\')"></span>' +
                '<div class="member-color-picker">' + swatches + '</div>' +
            '</div>' +
            '<input type="checkbox" ' + (data.assignees.includes(m.id) ? 'checked' : '') + ' onclick="event.stopPropagation();toggleAssignee(' + m.id + ')">' +
            escapeHtml(m.nom) +
        '</div>';
    }).join('');

    // #3 : charge par personne (heures par assigné)
    const chargeOf = (mid) => { const c = (data.charges || []).find(x => x.teamId === mid); return c ? c.heures : 0; };
    const chargeTotalH = (data.charges || []).reduce((sum, c) => (data.assignees.includes(c.teamId) ? sum + (Number(c.heures) || 0) : sum), 0);
    const chargeDescs = (!panelState.isNew && panelState.taskId) ? getAllDescendants(panelState.taskId) : [];
    const chargeConsol = chargeDescs.length ? TF.chargeByMember([{ charges: TF.chargesToJson(data.charges) }].concat(chargeDescs)) : null;
    const chargeConsolHtml = (chargeConsol && Object.keys(chargeConsol).length) ? ('<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"><div class="prop-label" style="margin-bottom:6px">Consolidé (avec sous-tâches)</div>' + Object.keys(chargeConsol).map(function(tid){ return '<div class="charge-row"><span class="an">' + escapeHtml(getTeamMemberName(Number(tid))) + '</span><span style="font-weight:600;font-size:0.82rem">' + chargeConsol[tid] + ' h</span></div>'; }).join('') + '<div style="margin-top:6px;font-size:0.78rem;color:var(--text-muted)">Total consolidé : <strong>' + Object.values(chargeConsol).reduce(function(s,h){ return s + h; }, 0) + '</strong> h</div></div>') : '';
    const chargeRows = data.assignees.map(id => '<div style="display:flex;align-items:center;gap:8px"><span style="flex:1;font-size:0.8rem">' + escapeHtml(getTeamMemberName(id)) + '</span><input type="number" min="0" step="0.5" value="' + chargeOf(id) + '" onchange="updateCharge(' + id + ', this.value)" style="width:64px;padding:4px 6px;border:1px solid var(--border);border-radius:6px"><span style="font-size:0.75rem;color:var(--text-muted)">h</span></div>').join('');

    const availableDeps = panelState.isNew ? tasks : getAvailableDependencies(panelState.taskId);
    const pastillesDeLien = (champ) => data[champ].map(id => {
        const d = tasks.find(t => t.id === id);
        return d ? '<span class="multi-select-chip">' + escapeHtml(d.titre) + '<span class="remove" onclick="event.stopPropagation();removeDependency(' + id + ', \'' + champ + '\')">×</span></span>' : '';
    }).join('');
    const optionsDeLien = (champ) => availableDeps.map(t =>
        '<div class="multi-select-option ' + (data[champ].includes(t.id) ? 'selected' : '') + '" onclick="toggleDependency(' + t.id + ', \'' + champ + '\')"><input type="checkbox" ' + (data[champ].includes(t.id) ? 'checked' : '') + ' onclick="event.stopPropagation();toggleDependency(' + t.id + ', \'' + champ + '\')">' + escapeHtml(t.titre) + '</div>'
    ).join('');
    const listeDeLien = (id, champ, etiquette, place) =>
        '<div class="dep-lien"><div class="prop-label">' + etiquette + '</div>' +
        '<div class="multi-select" id="' + id + '"><div class="multi-select-trigger" onclick="toggleMultiSelect(\'' + id + '\')"><div class="multi-select-values">' + (pastillesDeLien(champ) || '<span class="multi-select-placeholder">' + place + '</span>') + '</div><span class="multi-select-arrow">▾</span></div>' +
        '<div class="multi-select-dropdown">' + msSearch + (optionsDeLien(champ) || '<div class="multi-select-empty">Aucune</div>') + msNoResult + '</div></div></div>';

    const nbLiens = data.dependDe.length + (depDebutDisponible() ? data[COL_DEP_DEBUT].length : 0);
    let blockedHtml = '';
    if (!panelState.isNew) {
        const blocked = getBlockedTasks(panelState.taskId);
        const blockedDebut = getStartBlockedTasks(panelState.taskId);
        const groupe = (titre, liste) => liste.length
            ? '<div class="deps-group"><div class="deps-group-label">' + titre + '</div><div class="deps-list">' +
              liste.map(t => '<div class="dep-item" onclick="openTaskPanel(' + t.id + ')">→ ' + escapeHtml(t.titre) + '</div>').join('') +
              '</div></div>'
            : '';
        const groupes = groupe('→ Bloque :', blocked) + groupe('→ Démarre avec :', blockedDebut);
        if (groupes) blockedHtml = '<div class="deps-display">' + groupes + '</div>';
    }

    const tagsChips = data.tags.map(tag =>
        '<span class="tag-chip">#' + escapeHtml(tag) + '<span class="remove" onclick="removeTag(\'' + escapeHtml(tag) + '\')">×</span></span>'
    ).join('');
    const estim = data.estimationH || 0;
    const passe = data.tempsPasse || 0;
    const timePercent = estim > 0 ? Math.min((passe / estim) * 100, 100) : 0;
    const timeOver = passe > estim && estim > 0;

    // Prérequis jalon (auto depuis dependDe)
    const doneCount = data.dependDe.filter(id => { const t = tasks.find(x => x.id === id); return TF.isTerminal(statusCfg, t?.statut); }).length;
    const prereqHtml = data.dependDe.map(id => {
        const t = tasks.find(x => x.id === id);
        if (!t) return '';
        const st = t.statut || 'todo';
        return '<div class="prereq-item ' + (TF.isTerminal(statusCfg, st) ? 'done' : '') + '" onclick="openTaskPanel(' + id + ')"><span class="prereq-item-icon">' + (TF.isTerminal(statusCfg, st) ? '✓' : '○') + '</span><span class="prereq-item-title">' + escapeHtml(t.titre) + '</span><span class="prereq-badge" style="background:' + TF.getStatus(statusCfg, st).fillColor + ';color:' + TF.getStatus(statusCfg, st).textColor + '">' + escapeHtml(TF.getStatus(statusCfg, st).label) + '</span></div>';
    }).join('');

    content.innerHTML =
        '<div class="panel-type-row">' + pastillesDeType(data, chantier) + '</div>' +

        '<textarea rows="1" class="panel-title-edit" id="taskTitle" placeholder="' + titlePlaceholder + '" oninput="ajusterHauteurTitre(this);updateField(\'titre\', this.value, true)" onchange="updateField(\'titre\', this.value)">' + escapeHtml(data.titre) + '</textarea>' +

        '<div class="panel-section"><div class="panel-section-header"><span class="panel-section-title">' + descLabel + '</span></div>' +
        '<div class="form-group"><textarea class="form-textarea" id="taskDescription" placeholder="' + descLabel + '..." oninput="updateField(\'description\', this.value, true)" onchange="updateField(\'description\', this.value)">' + escapeHtml(data.description) + '</textarea></div></div>' +

        groupeDeProps(
            '<div class="prop-row"><span class="prop-label">Date' + (data.type === 'jalon' ? '' : 's') + '</span><div class="prop-value">' +
                (data.type === 'jalon' ?
                    '<div class="dates-inline"><input type="date" value="' + formatDateISO(s) + '" onchange="updateField(\'dateDebut\', this.value); updateField(\'dateEcheance\', this.value)"><button class="today-btn" onclick="setTodayDate()">Auj.</button></div>' :
                    '<div class="dates-inline"><input type="date" value="' + formatDateISO(s) + '" onchange="updateField(\'dateDebut\', this.value)"><span class="dates-arrow">→</span><input type="date" value="' + formatDateISO(e) + '" onchange="updateField(\'dateEcheance\', this.value)"><button class="today-btn" onclick="setTodayDate()">Auj.</button></div>') +
            '</div></div>' +
            '<div class="prop-row pr-status"><span class="prop-label">Statut</span><div class="prop-value"><div class="status-selector">' +
                (data.type !== 'jalon' ? statusCfg.list : statusCfg.list.filter(s => s.value === statusCfg.firstValue || s.value === statusCfg.terminalValue)).map(s => '<div class="status-pill ' + (data.statut === s.value ? 'selected' : '') + '" data-status="' + escapeHtml(s.value) + '" onclick="updateField(\'statut\', this.dataset.status)"><span class="panel-pill-dot" style="background:' + s.fillColor + '"></span>' + escapeHtml(s.label) + '</div>').join('') +
            '</div></div></div>' +
            (data.type === 'tache' ?
                '<div class="prop-row pr-prog"><span class="prop-label">Progression</span><div class="prop-value">' +
                    '<div class="progress-inline-wrap"><div class="progress-bar-mini"><div class="progress-bar-mini-fill" id="progressBarFill" style="width:' + data.progression + '%"></div></div><span class="progress-pct-label" id="progressValue">' + data.progression + '%</span></div>' +
                    '<div class="progress-presets">' +
                        '<div class="progress-preset ' + (data.progression === 0 ? 'active' : '') + '" onclick="setProgressPreset(0)">0%</div>' +
                        '<div class="progress-preset ' + (data.progression === 25 ? 'active' : '') + '" onclick="setProgressPreset(25)">25%</div>' +
                        '<div class="progress-preset ' + (data.progression === 50 ? 'active' : '') + '" onclick="setProgressPreset(50)">50%</div>' +
                        '<div class="progress-preset ' + (data.progression === 75 ? 'active' : '') + '" onclick="setProgressPreset(75)">75%</div>' +
                        '<div class="progress-preset ' + (data.progression === 100 ? 'active' : '') + '" onclick="setProgressPreset(100)">100%</div>' +
                    '</div>' +
                '</div></div>' : '')
        ) +

        groupeDeProps(
            ligneResponsable(data, responsableOptions, msSearch, msNoResult),
            '<div class="prop-row"><span class="prop-label">' + assignLabel + '</span><div class="prop-value">' +
                (data.assignees.length ? '<div class="asg-list">' + data.assignees.map(function(id){ var nm=getTeamMemberName(id)||'?'; var initials=nm.split(' ').filter(Boolean).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(); var mem=team.find(function(x){return x.id===id;}); return '<div class="asg"><span class="asg-ava" style="background:'+getTeamMemberColor(id)+'">'+escapeHtml(initials)+'</span><span class="an">'+escapeHtml(nm)+'</span>'+(mem&&mem.role?'<span class="ar">'+escapeHtml(mem.role)+'</span>':'')+'<button class="asg-x" title="Retirer" onclick="removeAssignee('+id+')">×</button></div>'; }).join('') + '</div>' : '') +
                '<div class="multi-select" id="assigneesSelect"><button class="addbtn" onclick="toggleMultiSelect(\'assigneesSelect\')"><span style="font-size:1rem;line-height:1">+</span> ' + (data.type === 'reunion' ? 'Ajouter un participant' : 'Ajouter un contributeur') + '</button><div class="multi-select-dropdown">' + msSearch + (assigneesOptions || '<div class="multi-select-empty">Aucun membre</div>') + msNoResult + '</div></div>' +
            '</div></div>' +
            '<div class="prop-row"><span class="prop-label">Projet</span><div class="prop-value"><div class="project-select-wrap">' +
                (currentProject
                    ? '<span class="project-color-dot" style="background:' + projectColor + '" title="Changer la couleur du projet" onclick="event.stopPropagation();this.nextElementSibling.classList.toggle(\'open\')"></span>' +
                      '<div class="color-picker-pop">' + COLOR_PRESETS.map(c => '<span class="color-swatch" style="background:' + c + '" onclick="event.stopPropagation();setProjectColor(' + currentProject.id + ',\'' + c + '\')"></span>').join('') + '</div>'
                    : '<span class="project-color-dot" style="background:' + projectColor + '"></span>') +
                '<select class="form-select" onchange="updateField(\'projet\', parseInt(this.value) || null)"><option value="">Aucun projet</option>' + projectOptions + '</select>' +
            '</div></div></div>'
        ) +

        (data.type !== 'jalon' && !chantier ? sectionChantier(data) : '') +

        groupeDeProps(
            (data.type !== 'reunion' && !chantier ?
                '<div class="prop-row"><span class="prop-label">Priorité</span><div class="prop-value"><div class="priority-selector">' +
                    '<div class="priority-pill p1 ' + (data.priorite == '1' ? 'selected' : '') + '" onclick="updateField(\'priorite\',\'1\')"><span class="panel-pill-dot" style="background:' + PRIORITY_COLORS[1] + '"></span>Critique</div>' +
                    '<div class="priority-pill p2 ' + (data.priorite == '2' ? 'selected' : '') + '" onclick="updateField(\'priorite\',\'2\')"><span class="panel-pill-dot" style="background:' + PRIORITY_COLORS[2] + '"></span>Haute</div>' +
                    '<div class="priority-pill p3 ' + (data.priorite == '3' ? 'selected' : '') + '" onclick="updateField(\'priorite\',\'3\')"><span class="panel-pill-dot" style="background:' + PRIORITY_COLORS[3] + '"></span>Moyenne</div>' +
                    '<div class="priority-pill p4 ' + (data.priorite == '4' ? 'selected' : '') + '" onclick="updateField(\'priorite\',\'4\')"><span class="panel-pill-dot" style="background:' + PRIORITY_COLORS[4] + '"></span>Basse</div>' +
                '</div></div></div>' : '')
        ) +

        // WBS-02: Section "Sous-tâches (enfants)" — structurelles, vraies tâches Grist
        (!panelState.isNew ? (function() {
            const kids = getChildren(panelState.taskId);
            const _par = data.parentTask ? tasks.find(x => x.id === data.parentTask) : null;
            const parentLink = _par ? '<div class="prereq-item" onclick="openTaskPanel(' + _par.id + ')" title="Ouvrir la tâche parent"><span style="flex-shrink:0;font-weight:700;color:var(--primary)">↑</span><span class="prereq-item-title">Parent : ' + escapeHtml(_par.titre) + '</span></div>' : '';
            const kidsList = kids.map(k => {
                const kp = getTaskPriority(k);
                const kprog = hasChildren(k) ? aggregateProgress(k) : (k.progression || 0);
                return '<div class="prereq-item" onclick="openTaskPanel(' + k.id + ')">' +
                    '<span class="task-priority-bar p' + kp + '" style="width:3px;height:16px;border-radius:2px;flex-shrink:0"></span>' +
                    '<span class="prereq-item-title">' + escapeHtml(k.titre) + '</span>' +
                    '<span class="prereq-badge ' + (k.statut || 'todo') + '">' + kprog + '%</span>' +
                '</div>';
            }).join('');
            const addBtn = '<button class="panel-btn" style="width:auto;padding:6px 12px;font-size:0.78rem;margin-top:6px;margin-right:6px" onclick="openCreateTaskWithParent(' + panelState.taskId + ')">+ Sous-tâche</button>';
            const adjustBtn = kids.length ? '<button class="btn" style="padding:6px 12px;font-size:0.78rem;margin-top:6px" onclick="adjustParentDatesToChildren()" title="Aligner les dates du parent sur min/max des descendants">↔ Ajuster dates</button>' : '';
            return '<div class="panel-section"><div class="panel-section-header"><span class="panel-section-title">Sous-tâches (hiérarchie)</span>' + (kids.length ? '<span class="panel-section-badge">' + kids.length + '</span>' : '') + '</div>' +
                parentLink +
                (kids.length ? '<div class="prereq-list">' + kidsList + '</div>' : '<div class="prereq-empty">Aucune sous-tâche. Décomposez cette tâche en étapes planifiables.</div>') +
                addBtn + adjustBtn + '</div>';
        })() : '') +

        groupeDeProps(
            // WBS-02: prop-row "Parent" — toujours affichée (création comprise), candidats filtrés par projet
            '<div class="prop-row"><span class="prop-label">Parent</span><div class="prop-value">' +
                (data.parentTask
                    ? '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                        '<span class="multi-select-chip" ' + (panelState.isNew ? '' : 'onclick="openTaskPanel(' + data.parentTask + ')"') + ' style="' + (panelState.isNew ? '' : 'cursor:pointer;') + 'background:var(--primary-light);color:var(--primary)">↑ ' + escapeHtml((tasks.find(t => t.id === data.parentTask) || {}).titre || '(inconnu)') + '</span>' +
                        '<button class="btn" style="padding:4px 10px;font-size:0.72rem" onclick="detachFromParent()">Détacher</button>' +
                      '</div>'
                    : '<div class="multi-select" id="parentSelect"><button class="addbtn" onclick="toggleMultiSelect(\'parentSelect\')"><span style="font-size:1rem;line-height:1">+</span> Choisir une tâche parent</button><div class="multi-select-dropdown">' + msSearch + (parentOptions || '<div class="multi-select-empty">Aucune tâche dans ce projet</div>') + msNoResult + '</div></div>') +
            '</div></div>'
        ) +

        (data.type !== 'jalon' ? (data.type !== 'reunion' ?
                '<div class="panel-section"><div class="panel-section-header"><span class="panel-section-title">Dépendances</span>' + (nbLiens ? '<span class="panel-section-badge">' + nbLiens + '</span>' : '') + '</div>' +
                '<div class="form-group">' +
                listeDeLien('depsSelect', 'dependDe', 'Commence après la fin de', 'Dépendances...') +
                // Pas sur un chantier : sa table ne porte pas de dépendances, la liste n'aurait pas
                // où écrire, comme celle des prérequis que le volet chantier retire déjà.
                (depDebutDisponible() && !chantier ? listeDeLien('depsDebutSelect', COL_DEP_DEBUT, 'Commence en même temps que', 'Aucune...') : '') +
                blockedHtml + '</div></div>' : '') : '') +

        (data.type !== 'jalon' ?
            '<div class="panel-section"><div class="panel-section-header"><span class="panel-section-title">Tags</span>' + (data.tags.length ? '<span class="panel-section-badge">' + data.tags.length + '</span>' : '') + '</div>' +
            '<div class="form-group"><div class="tags-input" onclick="document.getElementById(\'tagInput\').focus()">' + tagsChips + '<input type="text" id="tagInput" placeholder="' + (data.tags.length ? '' : 'Ajouter un tag...') + '" onkeydown="handleTagKeydown(event)"></div></div>'
            : '') +

        (data.type === 'jalon' ?
            '<div class="panel-section"><div class="panel-section-header"><span class="panel-section-title">Prérequis</span>' + (data.dependDe.length ? '<span class="panel-section-badge">' + doneCount + '/' + data.dependDe.length + '</span>' : '') + '</div>' +
            '<div class="prereq-list">' + (prereqHtml || '<div class="prereq-empty">Aucune dépendance — liez des tâches amont via le panneau d\'une tâche.</div>') + '</div></div>' : '') +

        groupeDeProps(
            (data.type === 'tache' ?
                '<div class="prop-row"><span class="prop-label">Temps &amp; charge</span><div class="prop-value">' +
                    '<div class="tc-grid">' +
                        '<div class="tc-box"><div class="tcl">Estimé</div><div class="tcv"><input type="number" min="0" step="0.5" value="' + (estim || '') + '" placeholder="0" onchange="updateField(\'estimationH\', parseFloat(this.value) || null)"><small>h</small></div></div>' +
                        '<div class="tc-box"><div class="tcl">Passé</div><div class="tcv"><input type="number" min="0" step="0.5" value="' + (passe || '') + '" placeholder="0" onchange="updateField(\'tempsPasse\', parseFloat(this.value) || null)"><small>h</small></div></div>' +
                    '</div>' +
                    (estim > 0 ? '<div class="tc-bar"><i class="' + (timeOver ? 'over' : '') + '" style="width:' + timePercent + '%"></i></div><div class="tc-foot"><span>' + Math.round((passe/estim)*100) + '% consommé</span><span>reste ' + Math.max(estim-passe,0) + ' h</span></div>' : '') +
                    ((data.assignees.length && TASK_COLS.has('charges')) ? '<div style="margin-top:13px"><div class="prop-label" style="margin-bottom:6px">Charge par personne</div>' + data.assignees.map(function(id){ return '<div class="charge-row"><span class="an">'+escapeHtml(getTeamMemberName(id))+'</span><input type="number" min="0" step="0.5" value="'+chargeOf(id)+'" onchange="updateCharge('+id+', this.value)"><span style="font-size:0.75rem;color:var(--text-muted)">h</span></div>'; }).join('') + '<div style="margin-top:6px;font-size:0.78rem;color:var(--text-muted)">Total : <strong>' + chargeTotalH + '</strong> h</div></div>' : '') + chargeConsolHtml +
                '</div></div>' : '')
        ) +

        (!panelState.isNew ?
            '<div class="panel-footer-left">' + (chantier ? '' : '<button class="panel-btn" onclick="dupliquerTache()" style="width:auto;padding:10px 14px;margin-right:8px;background:transparent;color:var(--text-muted);border:1px solid var(--border)">Dupliquer</button>') + '<button class="panel-btn danger" onclick="showDeleteConfirm()" style="width:auto;padding:10px 18px">Supprimer la tâche</button></div><div class="delete-confirm" id="deleteConfirm"><div class="delete-confirm-text">Supprimer ?</div><div class="delete-confirm-actions"><button class="delete-confirm-btn cancel" onclick="hideDeleteConfirm()">Annuler</button><button class="delete-confirm-btn confirm" onclick="confirmDelete()">Supprimer</button></div></div>' : '');

    if (chantier) adapterVoletChantier(content);
    ajusterHauteurTitre(document.getElementById('taskTitle'));

    if (panelState.isNew) {
        const canCreate = data.titre && data.titre.trim().length > 0;
        footer.innerHTML = '<div style="display:flex;gap:8px;width:100%"><button class="panel-btn" style="flex:0 0 auto;width:auto;padding:10px 16px;background:transparent;color:var(--text-muted);border:1px solid var(--border)" onclick="closePanel()">Annuler</button><button class="panel-btn success" onclick="' + (chantier ? 'createChantier()' : 'createTask()') + '" ' + (!canCreate ? 'disabled' : '') + ' style="flex:1;width:auto">Créer ' + (chantier ? 'le chantier' : 'la tâche') + '</button></div>';
    } else {
        footer.innerHTML = '';
    }
    if (!panelState.isNew) alignMiniGanttToday();
}

// Cale le défilement du mini Gantt du panneau sur la ligne « aujourd'hui » (près du bord gauche),
// comme le Gantt principal. Sans effet si aujourd'hui est hors de la plage du sous-arbre.
function alignMiniGanttToday() {
    const right = document.querySelector('#panelContent .mg-right');
    if (!right) return;
    const today = right.querySelector('.mg-today');
    if (!today) return;
    const todayLeft = parseInt(today.style.left, 10) || 0;
    right.scrollLeft = Math.max(0, todayLeft - 16);
}

// ═══════════════════════════════════════════════════════════════════════
// FIELD HANDLERS
// ═══════════════════════════════════════════════════════════════════════
function updateCharge(memberId, value) {
    const data = panelState.editData; if (!data) return;
    if (!Array.isArray(data.charges)) data.charges = [];
    const h = Math.max(0, Number(value) || 0);
    const existing = data.charges.find(c => c.teamId === memberId);
    if (existing) existing.heures = h; else data.charges.push({ teamId: memberId, heures: h });
    syncLocalTask(); if (!panelState.isNew && gristReady) saveTaskToGrist(); renderPanel();
}
function updateField(field, value, noSave) {
    const data = panelState.editData;
    if (!data) return;

    if (field === 'dateDebut' || field === 'dateEcheance') {
        if (!value) value = null;
        else {
            const saisie = new Date(value);
            // Annee en cours de frappe : on attend la saisie complete
            if (!TF.isPlausibleDate(saisie)) return;
            value = dateToGrist(saisie);
        }
    }
    // dateCloture auto : posee au statut terminal, effacee si reouverture
    if (field === 'statut') { const _wasT = TF.isTerminal(statusCfg, data.statut), _nowT = TF.isTerminal(statusCfg, value); if (_nowT && !_wasT) data.dateCloture = Math.floor(Date.now() / 1000); else if (!_nowT && _wasT) data.dateCloture = null; }

    data[field] = value;

    if (field === 'type' && value === 'jalon' && data.dateDebut) {
        data.dateEcheance = data.dateDebut;
    }

    // FIX: Synchroniser le task local pour affichage immédiat
    syncLocalTask();

    // Responsable en fait partie : il porte la couleur de la ligne et la tête affichée, et sa
    // sélection doit se voir dans la fiche sans attendre un rechargement.
    const visualFields = ['type', 'priorite', 'statut', 'projet', 'progression', 'dateDebut', 'dateEcheance', 'couleur', 'parentTask', 'Responsable'];
    if (visualFields.includes(field)) {
        renderPanel();
        if (!panelState.isNew) render();
    }

    if (field === 'titre' && panelState.isNew) {
        const btn = document.querySelector('.panel-footer .panel-btn.success');
        if (btn) btn.disabled = !value || !value.trim();
    }

    if (noSave) panelState.dirty = true;
    if (!panelState.isNew && !noSave && gristReady) { panelState.dirty = false; saveTaskToGrist(); }
}

function setProgressPreset(value) {
    const data = panelState.editData;
    if (!data) return;
    data.progression = value;
    syncLocalTask();

    const slider = document.querySelector('.progress-slider');
    const valueSpan = document.getElementById('progressValue');
    const barFill = document.getElementById('progressBarFill');
    if (slider) slider.value = value;
    if (valueSpan) valueSpan.textContent = value + '%';
    if (barFill) barFill.style.width = value + '%';
    document.querySelectorAll('.progress-preset').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.textContent) === value);
    });
    if (!panelState.isNew && gristReady) saveTaskToGrist();
    render();
}

function setTodayDate() {
    const data = panelState.editData;
    if (!data) return;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    data.dateDebut = dateToGrist(today);
    if (data.type === 'jalon') data.dateEcheance = data.dateDebut;
    syncLocalTask();
    if (!panelState.isNew && gristReady) saveTaskToGrist();
    renderPanel();
    render();
}

// Subtasks/Checklist
function getSubtasks(task) {
    if (!task?.subtasks) return [];
    try { return JSON.parse(task.subtasks); } catch (e) { return []; }
}
function subtasksToJson(subtasks) {
    return JSON.stringify(subtasks || []);
}
function addSubtask() {
    const input = document.getElementById('newSubtaskInput');
    const text = input?.value?.trim();
    if (!text) return;
    const data = panelState.editData;
    if (!data.subtasks) data.subtasks = [];
    data.subtasks.push({ id: Date.now(), text: text, done: false });
    input.value = '';
    updateSubtaskProgress();
    if (!panelState.isNew && gristReady) saveTaskToGrist();
    renderPanel();
    render();
}
function toggleSubtask(id) {
    const data = panelState.editData;
    if (!data.subtasks) return;
    const st = data.subtasks.find(s => s.id === id);
    if (st) {
        st.done = !st.done;
        updateSubtaskProgress();
        if (!panelState.isNew && gristReady) saveTaskToGrist();
        renderPanel();
        render();
    }
}
function removeSubtask(id) {
    const data = panelState.editData;
    if (!data.subtasks) return;
    const idx = data.subtasks.findIndex(s => s.id === id);
    if (idx !== -1) {
        data.subtasks.splice(idx, 1);
        updateSubtaskProgress();
        if (!panelState.isNew && gristReady) saveTaskToGrist();
        renderPanel();
        render();
    }
}
// Édite le texte d'un item de checklist (pas de renderPanel -> garde le focus dans l'input)
function editSubtask(id, value) {
    const data = panelState.editData;
    if (!data || !data.subtasks) return;
    const st = data.subtasks.find(s => s.id === id);
    if (!st) return;
    const t = (value || '').trim();
    if (!t || t === st.text) return;
    st.text = t;
    if (!panelState.isNew && gristReady) saveTaskToGrist();
    render();
}
function updateSubtaskProgress() {
    const data = panelState.editData;
    if (!data.subtasks || data.subtasks.length === 0) return;
    const done = data.subtasks.filter(s => s.done).length;
    const total = data.subtasks.length;
    data.progression = Math.round((done / total) * 100);
    syncLocalTask();
}
function handleSubtaskKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addSubtask(); }
}

function toggleMultiSelect(id) {
    const el = document.getElementById(id);
    document.querySelectorAll('.multi-select').forEach(s => { if (s.id !== id) s.classList.remove('open'); });
    el.classList.toggle('open');
    if (el.classList.contains('open')) {
        const search = el.querySelector('.multi-select-search');
        if (search) { search.value = ''; filterMultiSelectOptions(search); search.focus(); }
    }
}

// Les noms saisis dans le document portent leurs accents, pas toujours la recherche : on compare
// de part et d'autre une forme sans diacritiques.
const sansAccents = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Filtre les options sans re-render, pour garder le focus dans le champ.
function filterMultiSelectOptions(input) {
    const dd = input.closest('.multi-select-dropdown');
    if (!dd) return;
    const q = sansAccents(input.value.trim());
    let shown = 0;
    dd.querySelectorAll('.multi-select-option').forEach(opt => {
        const match = !q || sansAccents(opt.textContent).indexOf(q) !== -1;
        opt.style.display = match ? '' : 'none';
        if (match) shown++;
    });
    const nr = dd.querySelector('.multi-select-noresult');
    if (nr) nr.style.display = (q && shown === 0) ? 'block' : 'none';
}

function toggleAssignee(id) {
    const data = panelState.editData;
    const idx = data.assignees.indexOf(id);
    if (idx === -1) data.assignees.push(id);
    else data.assignees.splice(idx, 1);
    syncLocalTask();  // FIX
    if (!panelState.isNew && gristReady) saveTaskToGrist();
    renderPanel();
    render();
}

function removeAssignee(id) {
    const data = panelState.editData;
    const idx = data.assignees.indexOf(id);
    if (idx !== -1) {
        data.assignees.splice(idx, 1);
        syncLocalTask();  // FIX
        if (!panelState.isNew && gristReady) saveTaskToGrist();
        renderPanel();
        render();
    }
}

// `champ` désigne la liste visée : dependDe pour un lien fin→début, dependDebutDe pour un
// début→début. Les deux listes se manipulent à l'identique, seule la contrainte de dates diffère.
function toggleDependency(id, champ = 'dependDe') {
    const data = panelState.editData;
    const liste = data[champ];
    const idx = liste.indexOf(id);
    if (idx === -1) liste.push(id);
    else liste.splice(idx, 1);
    syncLocalTask();  // FIX
    if (!panelState.isNew && gristReady) saveTaskToGrist();
    renderPanel();
    render();
}

function removeDependency(id, champ = 'dependDe') {
    const data = panelState.editData;
    const liste = data[champ];
    const idx = liste.indexOf(id);
    if (idx !== -1) {
        liste.splice(idx, 1);
        syncLocalTask();  // FIX
        if (!panelState.isNew && gristReady) saveTaskToGrist();
        renderPanel();
        render();
    }
}

function handleTagKeydown(e) {
    const data = panelState.editData;
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const tag = e.target.value.trim().replace(/^#/, '');
        if (tag && !data.tags.includes(tag)) {
            data.tags.push(tag);
            e.target.value = '';
            syncLocalTask();  // FIX
            if (!panelState.isNew && gristReady) saveTaskToGrist();
            renderPanel();
        }
    } else if (e.key === 'Backspace' && !e.target.value && data.tags.length) {
        data.tags.pop();
        syncLocalTask();  // FIX
        if (!panelState.isNew && gristReady) saveTaskToGrist();
        renderPanel();
    }
}

function removeTag(tag) {
    const data = panelState.editData;
    const idx = data.tags.indexOf(tag);
    if (idx !== -1) {
        data.tags.splice(idx, 1);
        syncLocalTask();  // FIX
        if (!panelState.isNew && gristReady) saveTaskToGrist();
        renderPanel();
    }
}

function showDeleteConfirm() { document.getElementById('deleteConfirm').classList.add('visible'); }
function hideDeleteConfirm() { document.getElementById('deleteConfirm').classList.remove('visible'); }

// ═══════════════════════════════════════════════════════════════════════
// SAVE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════
async function saveTaskToGrist() {
    const data = panelState.editData;
    if (!data || panelState.isNew || !gristReady) return;
    if (data.dateDebut && data.dateEcheance && data.dateDebut > data.dateEcheance) {
        showToast('La date de début ne peut pas dépasser la date de fin', 'error');
        return;
    }
    if (panelState.estChantier) { await saveChantierToGrist(data); return; }

    const record = {
        titre: data.titre, description: data.description, type: data.type, priorite: data.priorite,
        statut: data.statut, progression: data.progression, dateDebut: data.dateDebut, dateEcheance: data.dateEcheance,
        projet: data.projet, assignees: toGristRefList(data.assignees), dependDe: toGristRefList(data.dependDe),
        dependDebutDe: toGristRefList(data.dependDebutDe),
        tags: toGristChoiceList(data.tags), estimationH: data.estimationH, tempsPasse: data.tempsPasse,
        subtasks: subtasksToJson(data.subtasks), couleur: data.couleur || null,
        parentTask: data.parentTask || null, chantier: data.chantier || null, Responsable: data.Responsable || null,
        charges: TF.chargesToJson((data.charges || []).filter(c => data.assignees.includes(c.teamId))), dateCloture: data.dateCloture || null
    };

    try {
        await grist.docApi.applyUserActions([['UpdateRecord', 'Tasks', panelState.taskId, pruneTaskRecord(record)]]);
        showSaveIndicator();
        const idx = tasks.findIndex(t => t.id === panelState.taskId);
        if (idx !== -1) tasks[idx] = { ...tasks[idx], ...record };
    } catch (e) {
        console.error(e);
        showToast('Erreur sauvegarde', 'error');
    }
}

// Enregistre un chantier dans sa propre table. L'identifiant affiché est décalé de ID_CHANTIER :
// seul l'identifiant réel part dans l'écriture. Les contributeurs remontent des tâches et ne sont
// pas écrits : le volet réécrirait la colonne avec la remontée à chaque enregistrement.
async function saveChantierToGrist(data) {
    const idChantier = panelState.taskId - ID_CHANTIER;
    if (idChantier <= 0) return;
    const colDebut = colonneDateChantier('debut');
    const colFin = colonneDateChantier('fin');
    const brut = { Nom_du_chantier: data.titre, Description: data.description, Responsable: data.Responsable || null };
    brut[colDebut] = data.dateDebut || null;
    brut[colFin] = data.dateEcheance || null;
    const record = pruneChantierRecord(brut);
    // La ligne locale ne reprend que ce qui est réellement parti : une colonne élaguée n'a pas été
    // enregistrée, l'afficher comme telle ferait mentir le graphique jusqu'au rechargement.
    const local = {};
    if ('Nom_du_chantier' in record) local.titre = record.Nom_du_chantier;
    if ('Description' in record) local.description = record.Description;
    if ('Responsable' in record) local.Responsable = record.Responsable;
    if (colDebut in record) local.dateDebut = record[colDebut];
    if (colFin in record) local.dateEcheance = record[colFin];
    try {
        await grist.docApi.applyUserActions([['UpdateRecord', 'Chantiers', idChantier, record]]);
        showSaveIndicator();
        const idx = tasks.findIndex(t => t.id === panelState.taskId);
        if (idx !== -1) tasks[idx] = Object.assign({}, tasks[idx], local);
    } catch (e) {
        console.error('Enregistrement du chantier refusé', e, record);
        showToast('Erreur sauvegarde : ' + messageErreur(e), 'error');
    }
}

// Plusieurs tâches se ressemblent souvent : la copie reprend tout le contenu de l'originale, y
// compris son rattachement, et s'ouvre aussitôt pour être renommée. Les sous-tâches ne suivent
// pas : dupliquer une branche entière serait rarement l'intention.
async function dupliquerTache() {
    const source = tasks.find(t => t.id === panelState.taskId);
    if (!source || estChantier(source) || !gristReady) return;
    if (panelState.dirty) await saveTaskToGrist();

    const record = pruneTaskRecord({
        titre: (source.titre || '') + ' (copie)', description: source.description || '',
        type: source.type || 'tache', priorite: source.priorite, statut: source.statut,
        progression: source.progression || 0, dateDebut: source.dateDebut, dateEcheance: source.dateEcheance,
        projet: source.projet || null, assignees: toGristRefList(getAssigneesArray(source)),
        dependDe: toGristRefList(getRefListArray(source.dependDe)), dependDebutDe: toGristRefList(getStartDependsOnArray(source)), tags: source.tags || null,
        estimationH: source.estimationH, tempsPasse: source.tempsPasse,
        subtasks: source.subtasks || '', couleur: source.couleur || null,
        parentTask: source.parentTask, chantier: source.chantier || null,
        charges: source.charges || '', dateCloture: null
    });

    try {
        const res = await grist.docApi.applyUserActions([['AddRecord', 'Tasks', null, record]]);
        const nouvelId = Array.isArray(res && res.retValues) ? res.retValues[0] : null;
        await loadAllData();
        if (nouvelId) openTaskPanel(nouvelId);
        showToast('Tâche dupliquée', 'success');
    } catch (e) {
        console.error(e);
        showToast('Erreur duplication', 'error');
    }
}

async function createTask() {
    const data = panelState.editData;
    if (!data || !data.titre || !data.titre.trim()) {
        showToast('Titre requis', 'error');
        return;
    }
    if (data.dateDebut && data.dateEcheance && data.dateDebut > data.dateEcheance) {
        showToast('La date de début ne peut pas dépasser la date de fin', 'error');
        return;
    }

    const record = {
        titre: data.titre, description: data.description || '', type: data.type || 'tache',
        priorite: data.priorite || '3', statut: data.statut || 'todo', progression: data.progression || 0,
        dateDebut: data.dateDebut, dateEcheance: data.dateEcheance, projet: data.projet,
        assignees: toGristRefList(data.assignees), dependDe: toGristRefList(data.dependDe),
        dependDebutDe: toGristRefList(data.dependDebutDe),
        tags: toGristChoiceList(data.tags), estimationH: data.estimationH, tempsPasse: data.tempsPasse,
        subtasks: subtasksToJson(data.subtasks), couleur: data.couleur || null,
        parentTask: data.parentTask || null, chantier: data.chantier || null,
        Responsable: data.Responsable || null,
        charges: TF.chargesToJson((data.charges || []).filter(c => data.assignees.includes(c.teamId))), dateCloture: data.dateCloture || null
    };

    if (gristReady) {
        try {
            await grist.docApi.applyUserActions([['AddRecord', 'Tasks', null, pruneTaskRecord(record)]]);
            showToast('Tâche créée', 'success');
            closePanel();
            await loadAllData();
        } catch (e) {
            console.error(e);
            showToast('Erreur création', 'error');
        }
    } else {
        record.id = Date.now();
        tasks.push(record);
        sortTasks();
        showToast('Tâche créée', 'success');
        closePanel();
        render();
    }
}

// Un chantier vit dans sa propre table, sous son identifiant réel : le volet en affiche un décalé
// de ID_CHANTIER. Ses tâches lui survivent et perdent seulement leur rattachement.
async function supprimerChantier() {
    const idChantier = panelState.taskId - ID_CHANTIER;
    if (idChantier <= 0) return;
    const rattachees = tasks.filter(t => !estChantier(t) && t.chantier === idChantier);
    if (!gristReady) {
        for (const t of rattachees) { t.chantier = null; t.parentTask = null; }
        tasks = tasks.filter(t => t.id !== panelState.taskId);
        showToast('Chantier supprimé', 'success');
        closePanel(); render();
        return;
    }
    const detachements = rattachees
        .map(t => ['UpdateRecord', 'Tasks', t.id, pruneTaskRecord({ chantier: null })])
        .filter(a => Object.keys(a[3]).length);
    try {
        await grist.docApi.applyUserActions(detachements.concat([['RemoveRecord', 'Chantiers', idChantier]]));
        showToast('Chantier supprimé', 'success');
        closePanel();
        await loadAllData();
    } catch (e) {
        console.error('Suppression du chantier refusée', e);
        showToast('Erreur suppression : ' + messageErreur(e), 'error');
    }
}

async function confirmDelete() {
    if (panelState.isNew || !panelState.taskId) return;
    if (panelState.estChantier) { await supprimerChantier(); return; }

    // WBS-05: si la tâche a des descendants, demander cascade ou détachement
    const descendants = getAllDescendants(panelState.taskId);
    let ids = [panelState.taskId];
    if (descendants.length) {
        const choice = confirm('Cette tâche contient ' + descendants.length + ' sous-tâche(s).\n\nOK = supprimer tout (cascade)\nAnnuler = détacher les enfants (ils deviennent racines)');
        if (choice) ids = [panelState.taskId, ...descendants.map(d => d.id)];
        else {
            // Détacher : mettre parentTask=null sur les enfants directs, puis delete le parent
            const directKids = getChildren(panelState.taskId);
            if (gristReady) {
                try {
                    const detachActions = directKids.map(k => ['UpdateRecord', 'Tasks', k.id, { parentTask: null }]);
                    await grist.docApi.applyUserActions([...detachActions, ['RemoveRecord', 'Tasks', panelState.taskId]]);
                    showToast('Supprimée (enfants détachés)', 'success');
                    closePanel(); await loadAllData();
                } catch (e) { showToast('Erreur suppression', 'error'); }
            }
            return;
        }
    }

    if (gristReady) {
        try {
            const actions = ids.map(id => ['RemoveRecord', 'Tasks', id]);
            await grist.docApi.applyUserActions(actions);
            showToast(ids.length > 1 ? `${ids.length} tâches supprimées` : 'Supprimée', 'success');
            closePanel();
            await loadAllData();
        } catch (e) {
            console.error(e);
            showToast('Erreur suppression', 'error');
        }
    } else {
        tasks = tasks.filter(t => !ids.includes(t.id));
        showToast('Supprimée', 'success');
        closePanel();
        render();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════════════════════════════════════
function startDrag(e, bar, type) {
    const id = parseInt(bar.dataset.id);
    const task = tasks.find(t => t.id === id);
    if (!task || estChantier(task)) return;
    if (isJalon(task) && type !== 'move') return;

    // WBS-02: parent autorisé uniquement pour 'move' (resize bloqué car ajusté auto)
    const isParent = hasChildren(task);
    if (isParent && type !== 'move') return;

    e.preventDefault();
    e.stopPropagation();

    // Capturer les descendants pour drag en bloc du parent
    const descendants = isParent ? getAllDescendants(id).map(d => ({
        id: d.id,
        originalStart: gristToDate(d.dateDebut),
        originalEnd: gristToDate(d.dateEcheance)
    })).filter(d => d.originalStart && d.originalEnd) : [];

    dragState = {
        active: true, type: type, taskId: id, startX: e.clientX,
        originalLeft: parseFloat(bar.style.left), originalWidth: parseFloat(bar.style.width),
        originalStart: gristToDate(task.dateDebut), originalEnd: gristToDate(task.dateEcheance),
        descendants: descendants, deplace: false
    };

    bar.style.zIndex = '100';
    bar.style.opacity = '0.8';

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
}

function onDrag(e) {
    if (!dragState.active) return;

    const pxPerDay = effectivePxPerDay;
    const dx = e.clientX - dragState.startX;
    const daysDelta = Math.round(dx / pxPerDay);
    const bar = document.querySelector('.gantt-bar[data-id="' + dragState.taskId + '"], .gantt-milestone[data-id="' + dragState.taskId + '"]');
    if (!bar) return;

    if (dragState.type === 'move') {
        bar.style.left = (dragState.originalLeft + daysDelta * pxPerDay) + 'px';
    } else if (dragState.type === 'resize-right') {
        const newWidth = Math.max(dragState.originalWidth + daysDelta * pxPerDay, pxPerDay);
        bar.style.width = newWidth + 'px';
    } else if (dragState.type === 'resize-left') {
        const newLeft = dragState.originalLeft + daysDelta * pxPerDay;
        const newWidth = dragState.originalWidth - daysDelta * pxPerDay;
        if (newWidth >= pxPerDay) {
            bar.style.left = newLeft + 'px';
            bar.style.width = newWidth + 'px';
        }
    }
}

async function endDrag(e) {
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);

    if (!dragState.active) return;

    const bar = document.querySelector('.gantt-bar[data-id="' + dragState.taskId + '"], .gantt-milestone[data-id="' + dragState.taskId + '"]');
    if (bar) { bar.style.zIndex = ''; bar.style.opacity = ''; }

    const task = tasks.find(t => t.id === dragState.taskId);
    if (!task) { dragState.active = false; return; }

    const pxPerDay = effectivePxPerDay;
    const dx = e.clientX - dragState.startX;
    const daysDelta = Math.round(dx / pxPerDay);

    // Renseigne avant tout await : le 'click' que le navigateur emet juste apres ce
    // 'mouseup' consulte ce drapeau pour distinguer un geste de redimensionnement
    // d'un simple clic sur la poignee.
    dragState.deplace = daysDelta !== 0;

    let newStart = dragState.originalStart, newEnd = dragState.originalEnd;
    if (dragState.type === 'move') { newStart = addDays(dragState.originalStart, daysDelta); newEnd = addDays(dragState.originalEnd, daysDelta); }
    else if (dragState.type === 'resize-right') newEnd = addDays(dragState.originalEnd, daysDelta);
    else if (dragState.type === 'resize-left') newStart = addDays(dragState.originalStart, daysDelta);

    task.dateDebut = dateToGrist(newStart);
    task.dateEcheance = dateToGrist(newEnd);

    // WBS-02: drag parent en bloc — décaler les descendants du même daysDelta (move uniquement)
    const childUpdates = [];
    if (dragState.type === 'move' && dragState.descendants && dragState.descendants.length) {
        for (const d of dragState.descendants) {
            const newS = addDays(d.originalStart, daysDelta);
            const newE = addDays(d.originalEnd, daysDelta);
            const child = tasks.find(x => x.id === d.id);
            if (child) { child.dateDebut = dateToGrist(newS); child.dateEcheance = dateToGrist(newE); }
            childUpdates.push({ id: d.id, dateDebut: dateToGrist(newS), dateEcheance: dateToGrist(newE) });
        }
    }

    // GANTT-06: Propager les changements aux tâches dépendantes
    const cascadeUpdates = propagateDependencyDates(task.id);

    if (gristReady) {
        try {
            const actions = [['UpdateRecord', 'Tasks', task.id, { dateDebut: task.dateDebut, dateEcheance: task.dateEcheance }]];
            childUpdates.forEach(u => actions.push(['UpdateRecord', 'Tasks', u.id, { dateDebut: u.dateDebut, dateEcheance: u.dateEcheance }]));
            cascadeUpdates.forEach(u => actions.push(['UpdateRecord', 'Tasks', u.id, { dateDebut: u.dateDebut, dateEcheance: u.dateEcheance }]));
            await grist.docApi.applyUserActions(actions);

            const extras = childUpdates.length + cascadeUpdates.length;
            showToast(extras > 0 ? `Dates mises à jour (+${extras} tâches liées)` : 'Dates mises à jour', 'success');
        } catch (err) { showToast('Erreur de mise à jour', 'error'); }
    }

    dragState.active = false;
    render();
}

// ═══════════════════════════════════════════════════════════════════════
// GRIST INTEGRATION
// ═══════════════════════════════════════════════════════════════════════
function convert(data) {
    if (!data || Array.isArray(data)) return data || [];
    const cols = Object.keys(data);
    if (!cols.length) return [];
    const n = data[cols[0]]?.length || 0;
    const r = [];
    for (let i = 0; i < n; i++) { const rec = {}; cols.forEach(c => rec[c] = data[c][i]); r.push(rec); }
    return r;
}

const TASKFLOW_SCHEMA = {
    Team: [{ id: 'nom', type: 'Text' }, { id: 'email', type: 'Text' }, { id: 'avatar', type: 'Text' }, { id: 'role', type: 'Choice' }, { id: 'actif', type: 'Bool' }, { id: 'couleur', type: 'Text' }],  // TEAM-01 (capaciteHebdo/indispos creees a la demande par le widget Plan)
    Projects: [{ id: 'nom', type: 'Text' }, { id: 'couleur', type: 'Text' }, { id: 'dateDebut', type: 'Date' }, { id: 'dateFin', type: 'Date' }, { id: 'responsable', type: 'Ref:Team' }, { id: 'actif', type: 'Bool' }],
    Tasks: [{ id: 'titre', type: 'Text' }, { id: 'description', type: 'Text' }, { id: 'dateDebut', type: 'Date' }, { id: 'dateEcheance', type: 'Date' }, { id: 'priorite', type: 'Choice' }, { id: 'statut', type: 'Choice' }, { id: 'progression', type: 'Numeric' }, { id: 'projet', type: 'Ref:Projects' }, { id: 'assignees', type: 'RefList:Team' }, { id: 'type', type: 'Choice' }, { id: 'dependDe', type: 'RefList:Tasks' }, { id: 'tags', type: 'ChoiceList' }, { id: 'estimationH', type: 'Numeric' }, { id: 'tempsPasse', type: 'Numeric' }, { id: 'couleur', type: 'Text' }, { id: 'subtasks', type: 'Text' }, { id: 'parentTask', type: 'Ref:Tasks' }]
};

async function ensureSchema() {
    let created = 0, added = 0;
    const tablesCreated = [];
    const prefetched = {};  // données lues ici pour la vérif, réutilisables par loadAllData si le schéma n'a pas bougé

    for (const [tableName, columns] of Object.entries(TASKFLOW_SCHEMA)) {
        let raw, tableExists;
        try { raw = await grist.docApi.fetchTable(tableName); tableExists = true; }
        catch (e) { try { await grist.docApi.applyUserActions([['AddTable', tableName, columns.map(c => ({ id: c.id, type: c.type }))]]); tablesCreated.push(tableName); created++; continue; } catch (e2) { continue; } }
        if (tableExists) { prefetched[tableName] = raw; const existingCols = Object.keys(raw).filter(c => c !== 'id' && c !== 'manualSort'); const missing = columns.filter(c => !existingCols.includes(c.id)); for (const col of missing) { try { await grist.docApi.applyUserActions([['AddColumn', tableName, col.id, { type: col.type }]]); added++; } catch (e) {} } }
    }
    if (tablesCreated.includes('Tasks')) await seedData();
    // Métadonnées lues une seule fois (après création éventuelle), partagées par les helpers ci-dessous.
    schemaMeta = await TF.fetchSchemaMeta(grist);
    await TF.seedStatusChoices(grist, 'Tasks', 'statut', TF.DEFAULT_STATUSES, schemaMeta);
    await TF.ensureUntiedLabels(grist, Object.fromEntries(Object.entries(TASKFLOW_SCHEMA).map(([t, cols]) => [t, cols.map(c => c.id)])), schemaMeta);
    await TF.setRefDisplayColumns(grist, [
        { table: 'Tasks', column: 'projet', visibleColId: 'nom' },
        { table: 'Tasks', column: 'assignees', visibleColId: 'nom' },
        { table: 'Tasks', column: 'dependDe', visibleColId: 'titre' },
        // parentTask ne prend 'titre' que s'il désigne bien une tâche : sur un document où il pointe
        // Chantiers, ce serait une colonne d'affichage inexistante.
        ...(parentTaskEstHierarchie() ? [{ table: 'Tasks', column: 'parentTask', visibleColId: 'titre' }] : []),
        { table: 'Projects', column: 'responsable', visibleColId: 'nom' }
    ], schemaMeta);
    if (created > 0 || added > 0) showToast('Schema initialisé (' + created + ' tables, ' + added + ' colonnes)', 'success');
    // Réutilisable seulement si le schéma n'a rien changé (sinon les données lues sont périmées).
    return (created === 0 && added === 0) ? prefetched : null;
}

async function seedData() {
    const today = new Date();
    const day = (d) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + d).getTime() / 1000;
    try {
        await grist.docApi.applyUserActions([
            ['AddRecord', 'Team', null, { nom: 'Alice Martin', email: 'alice@cerema.fr', role: 'Chef de projet', actif: true }],
            ['AddRecord', 'Team', null, { nom: 'Bob Durant', email: 'bob@cerema.fr', role: 'Développeur', actif: true }],
            ['AddRecord', 'Team', null, { nom: 'Claire Bernard', email: 'claire@cerema.fr', role: 'Designer', actif: true }]
        ]);
        await grist.docApi.applyUserActions([
            ['AddRecord', 'Projects', null, { nom: 'Refonte Portail', couleur: '#4f46e5', dateDebut: day(-15), dateFin: day(45), responsable: 1, actif: true }],
            ['AddRecord', 'Projects', null, { nom: 'App Mobile', couleur: '#10b981', dateDebut: day(-5), dateFin: day(60), responsable: 2, actif: true }]
        ]);
        const res = await grist.docApi.applyUserActions([
            ['AddRecord', 'Tasks', null, { titre: 'Cahier des charges', dateDebut: day(-15), dateEcheance: day(-8), priorite: '1', statut: 'done', progression: 100, projet: 1, type: 'tache', assignees: ['L', 1] }],
            ['AddRecord', 'Tasks', null, { titre: 'Maquettes UI/UX', dateDebut: day(-10), dateEcheance: day(-2), priorite: '2', statut: 'done', progression: 100, projet: 1, type: 'tache', assignees: ['L', 3] }],
            ['AddRecord', 'Tasks', null, { titre: 'Développement frontend', dateDebut: day(-3), dateEcheance: day(12), priorite: '1', statut: 'inprogress', progression: 35, projet: 1, type: 'tache', assignees: ['L', 2, 3], dependDe: ['L', 2] }],
            ['AddRecord', 'Tasks', null, { titre: 'Validation design', dateDebut: day(-2), dateEcheance: day(-2), priorite: '2', statut: 'done', progression: 100, projet: 1, type: 'jalon' }],
            ['AddRecord', 'Tasks', null, { titre: 'API backend', dateDebut: day(-5), dateEcheance: day(10), priorite: '1', statut: 'inprogress', progression: 55, projet: 1, type: 'tache', assignees: ['L', 2] }],
            ['AddRecord', 'Tasks', null, { titre: 'Proto mobile v1', dateDebut: day(1), dateEcheance: day(20), priorite: '2', statut: 'todo', progression: 0, projet: 2, type: 'tache', assignees: ['L', 2] }],
            ['AddRecord', 'Tasks', null, { titre: 'Livraison MVP', dateDebut: day(28), dateEcheance: day(28), priorite: '1', statut: 'todo', progression: 0, projet: 1, type: 'jalon', dependDe: ['L', 3, 5] }]
        ]);
        // WBS-01: exemple hiérarchique — 3 sous-tâches de "API backend" (id=5)
        const apiBackendId = Array.isArray(res?.retValues) ? res.retValues[4] : 5;
        await grist.docApi.applyUserActions([
            ['AddRecord', 'Tasks', null, { titre: 'Modèle de données', dateDebut: day(-5), dateEcheance: day(-1), priorite: '1', statut: 'done', progression: 100, projet: 1, type: 'tache', assignees: ['L', 2], estimationH: 12, tempsPasse: 12, parentTask: apiBackendId }],
            ['AddRecord', 'Tasks', null, { titre: 'Routes /users /auth', dateDebut: day(0), dateEcheance: day(5), priorite: '1', statut: 'inprogress', progression: 60, projet: 1, type: 'tache', assignees: ['L', 2], estimationH: 16, tempsPasse: 10, parentTask: apiBackendId }],
            ['AddRecord', 'Tasks', null, { titre: 'Tests unitaires API', dateDebut: day(6), dateEcheance: day(10), priorite: '2', statut: 'todo', progression: 0, projet: 1, type: 'tache', assignees: ['L', 2], estimationH: 8, parentTask: apiBackendId }]
        ]);
    } catch (e) { console.log('Seed error:', e); }
}

// Une table déclarée dans le document mais refusée à la lecture, c'est un problème de droits :
// l'écran est alors le même que celui d'une erreur de structure, et rien ne le disait.
let tablesRefusees = new Set();

function noterRefus(nom) {
    const declaree = schemaMeta && (schemaMeta.tables || []).some(t => t.tableId === nom);
    if (declaree) tablesRefusees.add(nom);
}

function signalerTablesRefusees() {
    const bandeau = document.getElementById('alerteTables');
    if (!bandeau) return;
    if (!tablesRefusees.size) { bandeau.hidden = true; return; }
    const noms = Array.from(tablesRefusees).join(', ');
    console.warn('[gantt] tables illisibles :', noms);
    bandeau.textContent = 'Lecture refusée sur : ' + noms + '. Le Gantt est incomplet, vérifiez vos accès à ces tables.';
    bandeau.hidden = false;
}

async function loadAllData(prefetched) {
    tablesRefusees = new Set();
    // prefetched : données déjà lues par ensureSchema à l'ouverture (évite une seconde lecture). Absent sur les rechargements onRecords → lecture fraîche.
    try { const _raw = (prefetched && prefetched.Tasks) || await grist.docApi.fetchTable('Tasks'); TASK_COLS = new Set(Object.keys(_raw || {})); tasks = convert(_raw); } catch (e) { tasks = []; noterRefus('Tasks'); }
    try { team = convert((prefetched && prefetched.Team) || await grist.docApi.fetchTable('Team')); } catch (e) { team = []; noterRefus('Team'); }
    try { projects = convert((prefetched && prefetched.Projects) || await grist.docApi.fetchTable('Projects')); } catch (e) { projects = []; noterRefus('Projects'); }
    // Categorie du sujet de niveau 1 (Projet / Produit / Offre de service), affichee en badge sur
    // le bandeau. Table absente sur un document qui ne la porte pas : le bandeau garde le nom seul.
    try { categoriesProjet = convert(await grist.docApi.fetchTable('Categorie_de_projet')); } catch (e) { categoriesProjet = []; noterRefus('Categorie_de_projet'); }
    gristReady = true;
    await fusionnerChantiers();
    entretenirOptionResponsable();
    rebuildChildrenCache();
    sortTasks();
    try { statusCfg = await TF.loadStatusConfig(grist, 'Tasks', 'statut', tasks.map(t => t && t.statut), schemaMeta); } catch (e) {}
    updateFilterMenus();
    signalerTablesRefusees();
    render();
}

async function initGrist() {
    // Phase 1 : tenter grist.ready — si Grist absent, basculer en démo
    try {
        await grist.ready({ requiredAccess: 'full' });
        gristPresent = true;
    } catch (e) {
        console.log('Grist unavailable, using demo:', e);
        useDemoMode();
        return;
    }
    // Phase 2 : ici on est dans Grist. Toute erreur est logguée mais ne bascule PAS en démo.
    let prefetched = null;
    try {
        prefetched = await ensureSchema();
    } catch (e) {
        console.error('ensureSchema error (continuing):', e);
        showToast('Schéma: ' + (e?.message || e), 'error');
    }
    try { filterDocId = await grist.docApi.getDocName(); } catch (e) {}
    hydrateFilters();
    try {
        await loadAllData(prefetched);
    } catch (e) {
        console.error('loadAllData error (continuing):', e);
        showToast('Chargement: ' + (e?.message || e), 'error');
    }
    try {
        grist.onRecords(async () => await loadAllData());
        grist.onRecord((rec) => {
            if (rec?.id && rec.id !== selectedTaskId) {
                selectedTaskId = rec.id;
                let cur = tasks.find(t => t.id === rec.id), guard = 0;
                while (cur?.parentTask && guard++ < 64) {
                    expandedTasks.add(cur.parentTask);
                    cur = tasks.find(t => t.id === cur.parentTask);
                }
                render();
            }
        });
        let filtersBootstrapConsumed = false;
        grist.onOptions((options, interaction) => {
            if (options?.filters && interaction?.source !== 'self') {
                // Le premier onOptions rejoue les options du store de section : on l'ignore, localStorage fait foi.
                if (!filtersBootstrapConsumed) { filtersBootstrapConsumed = true; return; }
                const f = options.filters;
                filters.project = Array.isArray(f.project) ? f.project : [];
                filters.priority = Array.isArray(f.priority) ? f.priority : [];
                filters.assignee = Array.isArray(f.assignee) ? f.assignee : [];
                persistFilters();
                updateFilterMenus();
                render();
            }
        });
        window.addEventListener('storage', (e) => {
            if (e.key === filterStorageKey()) { hydrateFilters(); updateFilterMenus(); render(); }
        });
    } catch (e) {
        console.error('Grist listeners error:', e);
    }
}

function useDemoMode() {
    document.body.insertAdjacentHTML('beforeend', '<div class="demo-badge">Démo</div>');

    team = [
        { id: 1, nom: 'Alice Martin', actif: true, couleur: '#4f46e5' },
        { id: 2, nom: 'Bob Durant', actif: true, couleur: '#10b981' },
        { id: 3, nom: 'Claire Bernard', actif: true, couleur: '#f59e0b' }
    ];
    projects = [
        { id: 1, nom: 'Refonte Portail', couleur: '#4f46e5', actif: true },
        { id: 2, nom: 'App Mobile', couleur: '#10b981', actif: true },
        { id: 3, nom: 'API v2', couleur: '#f59e0b', actif: true }
    ];

    const today = new Date();
    const day = (d) => dateToGrist(new Date(today.getFullYear(), today.getMonth(), today.getDate() + d));

    tasks = [
        { id: 1, titre: 'Analyse besoins', priorite: '1', projet: 1, dateDebut: day(-10), dateEcheance: day(-5), progression: 100, statut: 'done', type: 'tache', assignees: ['L', 1], tags: ['L', 'documentation'] },
        { id: 2, titre: 'Dev Backend', priorite: '1', projet: 1, dateDebut: day(-4), dateEcheance: day(2), progression: 60, statut: 'inprogress', type: 'tache', dependDe: ['L', 1], assignees: ['L', 1, 2], estimationH: 32, tempsPasse: 12 },
        { id: 3, titre: 'Design UI', priorite: '2', projet: 2, dateDebut: day(-5), dateEcheance: day(1), progression: 80, statut: 'review', type: 'tache', assignees: ['L', 3] },
        { id: 4, titre: 'Livraison MVP', priorite: '1', projet: 1, dateDebut: day(15), dateEcheance: day(15), progression: 0, statut: 'todo', type: 'jalon', dependDe: ['L', 2], assignees: ['L', 1] },
        { id: 5, titre: 'Tests QA', priorite: '3', projet: 2, dateDebut: day(5), dateEcheance: day(12), progression: 0, statut: 'todo', type: 'tache', assignees: ['L', 2], tags: ['L', 'qa', 'tests'] },
        { id: 6, titre: 'Documentation', priorite: '4', projet: 3, dateDebut: day(-2), dateEcheance: day(-1), progression: 20, statut: 'inprogress', type: 'tache', assignees: ['L', 3] },
        { id: 7, titre: 'Correction bugs', priorite: '2', projet: 1, dateDebut: day(0), dateEcheance: day(3), progression: 10, statut: 'inprogress', type: 'tache', assignees: ['L', 2] },
        { id: 8, titre: 'Réunion client', priorite: '2', projet: 2, dateDebut: day(7), dateEcheance: day(7), progression: 0, statut: 'todo', type: 'reunion', assignees: ['L', 1, 3] },
        { id: 9, titre: 'Migration DB', priorite: '1', projet: 3, dateDebut: day(-3), dateEcheance: day(0), progression: 90, statut: 'review', type: 'tache', assignees: ['L', 1] },
        { id: 10, titre: 'Formation équipe', priorite: '3', projet: 1, dateDebut: day(10), dateEcheance: day(14), progression: 0, statut: 'todo', type: 'reunion', assignees: ['L', 2, 3] },
        // WBS-01: exemple hiérarchique — 3 enfants de "Dev Backend" (id=2)
        { id: 11, titre: 'Modèle de données', priorite: '1', projet: 1, dateDebut: day(-4), dateEcheance: day(-1), progression: 100, statut: 'done', type: 'tache', assignees: ['L', 2], estimationH: 12, tempsPasse: 12, parentTask: 2 },
        { id: 12, titre: 'Routes /users /auth', priorite: '1', projet: 1, dateDebut: day(0), dateEcheance: day(5), progression: 60, statut: 'inprogress', type: 'tache', assignees: ['L', 2], estimationH: 16, tempsPasse: 10, parentTask: 2 },
        { id: 13, titre: 'Tests unitaires API', priorite: '2', projet: 1, dateDebut: day(6), dateEcheance: day(10), progression: 0, statut: 'todo', type: 'tache', assignees: ['L', 2], estimationH: 8, parentTask: 2 }
    ];

    rebuildChildrenCache();
    sortTasks();
    hydrateFilters();
    updateFilterMenus();
    render();
}

// ═══════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════
// Report de render() pendant un geste souris : capture pour s'armer avant tout
// stopPropagation() pose par startDrag() sur le mousedown d'une barre ou d'une
// poignee de redimensionnement.
document.addEventListener('mousedown', () => {
    // Annule un desarmement encore en attente (mouseup precedent) : sans cela, un
    // mousedown survenant avant l'execution de ce setTimeout (fil occupe par un rendu
    // lourd) se ferait desarmer par erreur des que ce minuteur perime se declenche.
    if (timeoutDesarmement !== null) { clearTimeout(timeoutDesarmement); timeoutDesarmement = null; }
    gesteSourisEnCours = true;
}, true);
// Desarme le geste en cours et rejoue le rendu s'il a ete reporte.
function terminerGesteSouris() {
    gesteSourisEnCours = false;
    if (renduEnAttente) { renduEnAttente = false; render(); }
}
document.addEventListener('mouseup', () => {
    // Le navigateur emet 'click' juste apres 'mouseup' : le desarmement et le
    // rendu differe sont repousses d'un tour de boucle pour laisser ce 'click'
    // partir sur une cible encore attachee au DOM.
    timeoutDesarmement = setTimeout(() => { timeoutDesarmement = null; terminerGesteSouris(); }, 0);
}, true);
// Filet : si le relachement n'arrive jamais dans la page (curseur sorti de la
// fenetre, perte de focus de l'onglet), on ne reste pas bloque avec un rendu
// jamais rejoue.
window.addEventListener('blur', terminerGesteSouris);
document.addEventListener('mouseleave', terminerGesteSouris);
// Un glisser natif HTML5 (reordonnancement manuel de la liste des taches, Sortable.js)
// n'emet jamais de 'mouseup' : la sequence reelle est mousedown, dragstart, drop,
// dragend. Sans ce desarmement, gesteSourisEnCours resterait arme et tout render()
// ulterieur serait avale jusqu'au prochain clic. Desarmement immediat, sans le tour de
// boucle utilise pour le mouseup : aucun 'click' ne suit un glisser natif, il n'y a rien
// a laisser partir sur une cible encore attachee.
document.addEventListener('dragend', terminerGesteSouris, true);
document.addEventListener('drop', terminerGesteSouris, true);

// Grist ne notifie que la table du widget : une modification dans les effectifs, les projets ou les
// chantiers passe inaperçue, et la vue garde des couleurs ou des libellés périmés. On relit quand le
// widget reprend la main, ce qui couvre le geste réel : aller modifier la table, puis revenir.
// Le drapeau évite une seconde lecture à l'ouverture, où un 'focus' arrive sans qu'on ait rien perdu.
let mainPerdue = false;
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') mainPerdue = true;
    else relireSiLaMainRevient();
});
window.addEventListener('blur', () => { mainPerdue = true; });
window.addEventListener('focus', relireSiLaMainRevient);

function relireSiLaMainRevient() {
    if (!mainPerdue || !gristReady || gesteSourisEnCours) return;
    mainPerdue = false;
    loadAllData();
}

document.addEventListener('click', (e) => {
    // Fermer les menus dropdown
    if (!e.target.closest('.filter-dropdown')) {
        document.querySelectorAll('.filter-menu').forEach(m => m.classList.remove('open'));
    }
    if (!e.target.closest('.multi-select')) {
        document.querySelectorAll('.multi-select').forEach(s => s.classList.remove('open'));
    }
    // Fermer les pickers couleur (Projects / Team) si clic extérieur
    if (!e.target.closest('.color-picker-pop, .project-color-dot, .member-color-picker, .member-color-dot')) {
        document.querySelectorAll('.color-picker-pop, .member-color-picker').forEach(p => p.classList.remove('open'));
    }
    // GEN-01: Désélection si clic en dehors d'une barre, du panel ou des contrôles
    if (!e.target.closest('.gantt-bar, .gantt-milestone, .panel, .task-row, .toolbar, .filter-dropdown, .view-controls')) {
        if (selectedTaskId !== null && !panelState.open) {
            selectedTaskId = null;
            render();
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panelState.open) confirmClosePanel();
    if (panelState.open && !panelState.isNew && !e.target.matches('input, textarea, select')) {
        if (e.key === 'ArrowLeft') navigatePanelTask(-1);
        if (e.key === 'ArrowRight') navigatePanelTask(1);
    }
});

// ═══════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════
document.documentElement.style.setProperty('--cell-width', VIEW_CONFIG[currentView].cellWidth + 'px');
// Initialiser le bouton vue actif depuis localStorage
document.querySelectorAll('.view-controls .btn').forEach(b => b.classList.toggle('active', b.dataset.view === currentView));
// Synchroniser le <select> de tri avec sortMode restauré depuis localStorage
{ const s = document.getElementById('sortSelect'); if (s) s.value = sortMode; }
// Idem pour le <select> de couleur
{ const s = document.getElementById('colorSelect'); if (s) s.value = colorMode; }
restaurerLargeurs();
afficherVersion();
brancherPoignee('poigneeTaskList', 'taskList', 1);
brancherPoignee('poigneePanel', 'panel', -1);
// Relancer le rendu quand le widget est redimensionné (ex: panel ouvert/fermé, fenêtre)
new ResizeObserver(() => render()).observe(document.getElementById('timelineScroll'));
// Décorateur panneau (look « Propriétés / B ») : icône devant chaque libellé, sans toucher au rendu
(function(){
    var P={
        statut:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        priorite:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
        date:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        projet:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
        couleur:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
        parent:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
        assigne:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        charge:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        progression:'<svg class="tf-pic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
    };
    function pic(txt){ var t=(txt||'').toLowerCase();
        if(t.indexOf('statut')>=0)return P.statut;
        if(t.indexOf('priorit')>=0)return P.priorite;
        if(t.indexOf('date')>=0)return P.date;
        if(t.indexOf('projet')>=0)return P.projet;
        if(t.indexOf('couleur')>=0)return P.couleur;
        if(t.indexOf('parent')>=0)return P.parent;
        if(t.indexOf('assign')>=0||t.indexOf('particip')>=0||t.indexOf('quipe')>=0)return P.assigne;
        if(t.indexOf('charge')>=0)return P.charge;
        if(t.indexOf('progress')>=0)return P.progression;
        return ''; }
    function collapse(c){
        ['status-selector','priority-selector'].forEach(function(cls){
            c.querySelectorAll('.prop-value .'+cls+':not(.tfc)').forEach(function(sel){
                sel.classList.add('tfc');
                sel.addEventListener('click', function(ev){
                    if(!sel.classList.contains('tfo')){ ev.stopPropagation(); ev.preventDefault();
                        document.querySelectorAll('.tfc.tfo').forEach(function(o){ o.classList.remove('tfo'); });
                        sel.classList.add('tfo'); }
                }, true);
            });
        });
    }
    function deco(){ var c=document.getElementById('panelContent'); if(!c)return;
        c.querySelectorAll('.prop-label:not([data-dec])').forEach(function(l){ l.setAttribute('data-dec','1'); var s=pic(l.textContent); if(s)l.insertAdjacentHTML('afterbegin',s); });
        /* collapse(c) désactivé — structure A : sélecteurs déployés */ }
    var c=document.getElementById('panelContent');
    if(c){ try{ new MutationObserver(deco).observe(c,{childList:true}); }catch(e){} deco(); }
    document.addEventListener('click', function(ev){ document.querySelectorAll('.tfc.tfo').forEach(function(o){ if(!o.contains(ev.target)) o.classList.remove('tfo'); }); });
})();
renderGanttSkeleton();  // 06 · squelette pendant le chargement
// Repli auto vers données d'exemple si Grist n'a pas répondu au handshake sous 2.8s
// (aperçu / hors-ligne). Des lectures lentes ne comptent pas : Grist est là, on attend.
setTimeout(function(){ try { if (!gristPresent && typeof useDemoMode==='function') useDemoMode(); } catch(e){ console.log(e); } }, 2800);
try { if (new URLSearchParams(location.search).has('nav')) document.body.classList.add('suite-nav'); } catch (e) {}
initGrist();
