/* ============================================================================
 * taskflow-core.js — Module commun aux widgets TaskFlow
 * ----------------------------------------------------------------------------
 * SOURCE UNIQUE. Inline dans chaque widget par scripts/build-taskflow.js entre
 * les marqueurs de generation prevus a cet effet.
 * NE PAS editer la copie inlinee dans les .html : editer CE fichier puis lancer
 *   npm run build:taskflow
 *
 * Expose un objet `TF` (namespace) pour ne jamais entrer en collision avec les
 * helpers locaux existants des widgets. Toutes les fonctions qui ecrivent dans
 * Grist sont DEFENSIVES : en cas d'echec elles n'interrompent jamais le widget
 * (au pire, comportement actuel inchange).
 * ========================================================================== */
const TF = (function () {
    'use strict';

    /* ----- Statuts ---------------------------------------------------------
     * Convention : l'ORDRE fait foi. Le DERNIER statut de la liste est l'etat
     * terminal ("termine") utilise par la logique de completion des widgets.
     * Les statuts reels proviennent de la colonne Choice `statut` (editable par
     * l'utilisateur dans Grist). DEFAULT_STATUSES n'est qu'un repli.
     * --------------------------------------------------------------------- */
    const DEFAULT_STATUSES = [
        { value: 'todo',       label: 'À faire',  fillColor: '#94a3b8', textColor: '#ffffff' },
        { value: 'inprogress', label: 'En cours', fillColor: '#f59e0b', textColor: '#ffffff' },
        { value: 'review',     label: 'En revue', fillColor: '#3b82f6', textColor: '#ffffff' },
        { value: 'done',       label: 'Terminé',  fillColor: '#10b981', textColor: '#ffffff' }
    ];
    // Repli libelle + couleur pour les CODES par defaut. Permet d'afficher un libelle
    // FR (et la bonne couleur) meme quand la colonne Choice stocke le code brut
    // (todo/inprogress/...). Une valeur renommee par l'utilisateur garde SON libelle.
    const DEFAULTS_BY_VALUE = {};
    for (var _i = 0; _i < DEFAULT_STATUSES.length; _i++) DEFAULTS_BY_VALUE[DEFAULT_STATUSES[_i].value] = DEFAULT_STATUSES[_i];

    // Convertit un tableau Grist colonnaire en tableau d'objets lignes.
    function columnarToRows(data) {
        if (!data || Array.isArray(data)) return data || [];
        const cols = Object.keys(data);
        if (!cols.length) return [];
        const n = (data[cols[0]] && data[cols[0]].length) || 0;
        const rows = [];
        for (let i = 0; i < n; i++) {
            const rec = {};
            for (const k of cols) rec[k] = data[k][i];
            rows.push(rec);
        }
        return rows;
    }

    // Resout le rowId d'une table depuis son tableId via _grist_Tables.
    // `meta` (optionnel) = { tables, cols } deja lus : evite un fetchTable de plus.
    async function tableRowId(grist, tableId, meta) {
        const rows = meta && meta.tables ? meta.tables : columnarToRows(await grist.docApi.fetchTable('_grist_Tables'));
        const row = rows.find(r => r.tableId === tableId);
        return row ? row.id : null;
    }

    // Lit les deux tables de metadonnees en une passe (parallele), a partager entre helpers.
    async function fetchSchemaMeta(grist) {
        const [t, c] = await Promise.all([
            grist.docApi.fetchTable('_grist_Tables'),
            grist.docApi.fetchTable('_grist_Tables_column')
        ]);
        return { tables: columnarToRows(t), cols: columnarToRows(c) };
    }

    // Construit une config de statuts normalisee depuis une liste brute.
    function buildStatusConfig(list, source) {
        const clean = (list || []).filter(s => s && s.value != null).map(s => {
            const v = String(s.value);
            const d = DEFAULTS_BY_VALUE[v];
            const hasExplicitLabel = s.label != null && s.label !== '' && String(s.label) !== v;
            return {
                value: v,
                label: hasExplicitLabel ? String(s.label) : (d ? d.label : v),
                fillColor: s.fillColor || (d ? d.fillColor : '#94a3b8'),
                textColor: s.textColor || (d ? d.textColor : '#ffffff')
            };
        });
        const final = clean.length ? clean : DEFAULT_STATUSES.slice();
        const byValue = {};
        for (const s of final) byValue[s.value] = s;
        return {
            list: final,
            byValue,
            values: final.map(s => s.value),
            terminalValue: final[final.length - 1].value, // convention "dernier = termine"
            firstValue: final[0].value,
            source: clean.length ? source : 'default'
        };
    }

    /* Lit les statuts (libelles + couleurs + ordre) depuis la colonne Choice
     * indiquee, via les metadonnees Grist. Repli en cascade :
     *   1. options de la colonne Choice (cas ideal)
     *   2. valeurs distinctes presentes dans les donnees (colonne Text)
     *   3. DEFAULT_STATUSES
     * Ne jette jamais : retourne toujours une config exploitable.
     */
    async function loadStatusConfig(grist, table, column, distinctFallback, meta) {
        try {
            const tid = await tableRowId(grist, table, meta);
            if (tid != null) {
                const cols = meta && meta.cols ? meta.cols : columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
                const col = cols.find(c => c.parentId === tid && c.colId === column);
                if (col && col.widgetOptions) {
                    let opt = {};
                    try { opt = JSON.parse(col.widgetOptions) || {}; } catch (e) { opt = {}; }
                    const choices = Array.isArray(opt.choices) ? opt.choices : [];
                    const co = opt.choiceOptions || {};
                    if (choices.length) {
                        return buildStatusConfig(choices.map(ch => ({
                            value: ch,
                            label: ch,
                            fillColor: co[ch] && co[ch].fillColor,
                            textColor: co[ch] && co[ch].textColor
                        })), 'choice');
                    }
                }
            }
        } catch (e) { /* repli silencieux */ }

        if (Array.isArray(distinctFallback) && distinctFallback.length) {
            const seen = [];
            for (const v of distinctFallback) { if (v != null && v !== '' && seen.indexOf(v) === -1) seen.push(v); }
            if (seen.length) return buildStatusConfig(seen.map(v => ({ value: v, label: v })), 'data');
        }
        return buildStatusConfig(DEFAULT_STATUSES.slice(), 'default');
    }

    function getStatus(cfg, value) {
        if (cfg && cfg.byValue && cfg.byValue[value]) return cfg.byValue[value];
        return { value: value, label: value || '', fillColor: '#94a3b8', textColor: '#ffffff' };
    }
    function isTerminal(cfg, value) { return !!cfg && value === cfg.terminalValue; }

    /* Seme les options (choix + couleurs) sur une colonne Choice si elle n'en a
     * pas encore. Defensif. A appeler depuis ensureSchema apres creation.
     */
    async function seedStatusChoices(grist, table, column, statuses, meta) {
        try {
            const tid = await tableRowId(grist, table, meta);
            if (tid == null) return;
            const cols = meta && meta.cols ? meta.cols : columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
            const col = cols.find(c => c.parentId === tid && c.colId === column);
            if (!col) return;
            let opt = {};
            try { opt = JSON.parse(col.widgetOptions || '{}') || {}; } catch (e) { opt = {}; }
            if (Array.isArray(opt.choices) && opt.choices.length) return; // deja configure : on respecte
            const list = statuses && statuses.length ? statuses : DEFAULT_STATUSES;
            const choiceOptions = {};
            for (const s of list) choiceOptions[s.value] = { fillColor: s.fillColor, textColor: s.textColor };
            const widgetOptions = JSON.stringify({ choices: list.map(s => s.value), choiceOptions: choiceOptions });
            await grist.docApi.applyUserActions([['ModifyColumn', table, column, { widgetOptions: widgetOptions }]]);
        } catch (e) { console.warn('TF.seedStatusChoices:', e && e.message); }
    }

    /* ----- #2 : colonnes d'affichage des Ref (noms au lieu des IDs) ---------
     * Pose le visibleCol + la display formula sur des colonnes Ref pour que les
     * VUES NATIVES Grist affichent un libelle plutot que l'ID de ligne.
     * specs : [{ table:'Tasks', column:'projet', visibleColId:'nom' }, ...]
     * DEFENSIF : si Grist refuse une action, on log et on continue ; au pire
     * l'affichage reste en IDs (comportement actuel), jamais de casse.
     * --------------------------------------------------------------------- */
    async function setRefDisplayColumns(grist, specs, meta) {
        if (!Array.isArray(specs) || !specs.length) return;
        try {
            const tables = meta && meta.tables ? meta.tables : columnarToRows(await grist.docApi.fetchTable('_grist_Tables'));
            const cols = meta && meta.cols ? meta.cols : columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
            const tidOf = (tableId) => { const r = tables.find(t => t.tableId === tableId); return r ? r.id : null; };
            const colOf = (tableRow, colId) => cols.find(c => c.parentId === tableRow && c.colId === colId);

            const actions = [];
            for (const s of specs) {
                const srcTid = tidOf(s.table);
                if (srcTid == null) continue;
                const refCol = colOf(srcTid, s.column);
                if (!refCol) continue;
                // Table cible deduite du type "Ref:Target" / "RefList:Target".
                const m = /^(?:Ref|RefList):(.+)$/.exec(refCol.type || '');
                if (!m) continue;
                const targetTid = tidOf(m[1]);
                if (targetTid == null) continue;
                const visCol = colOf(targetTid, s.visibleColId);
                if (!visCol) continue;
                // Eviter de re-poser si deja correct.
                if (refCol.visibleCol === visCol.id) continue;
                actions.push(['SetDisplayFormula', s.table, null, refCol.id, '$' + s.column + '.' + s.visibleColId]);
                actions.push(['UpdateRecord', '_grist_Tables_column', refCol.id, { visibleCol: visCol.id }]);
            }
            if (actions.length) await grist.docApi.applyUserActions(actions);
        } catch (e) { console.warn('TF.setRefDisplayColumns:', e && e.message); }
    }

    /* ----- #2bis : delier colId <-> label (renommage libre des libelles) ----
     * Pose untieColIdFromLabel=true sur les colonnes du widget. Sans ca, Grist
     * regenere le colId a chaque changement de libelle, et le widget (qui lit et
     * ecrit tout par colId) perd ses colonnes. Idempotent (saute les colonnes
     * deja deliees) et defensif (jamais de casse), applique aux docs neufs comme
     * existants a chaque ouverture.
     * tableColumns : { Tasks:['titre',...], Team:[...], Projects:[...] }
     * --------------------------------------------------------------------- */
    async function ensureUntiedLabels(grist, tableColumns, meta) {
        if (!tableColumns) return;
        try {
            const tables = meta && meta.tables ? meta.tables : columnarToRows(await grist.docApi.fetchTable('_grist_Tables'));
            const cols = meta && meta.cols ? meta.cols : columnarToRows(await grist.docApi.fetchTable('_grist_Tables_column'));
            const tidOf = (tableId) => { const r = tables.find(t => t.tableId === tableId); return r ? r.id : null; };
            const actions = [];
            for (const tableName of Object.keys(tableColumns)) {
                const tid = tidOf(tableName);
                if (tid == null) continue;
                for (const colId of tableColumns[tableName] || []) {
                    const col = cols.find(c => c.parentId === tid && c.colId === colId);
                    if (!col) continue;
                    if (col.untieColIdFromLabel === true) continue;
                    actions.push(['ModifyColumn', tableName, colId, { untieColIdFromLabel: true }]);
                }
            }
            if (actions.length) await grist.docApi.applyUserActions(actions);
        } catch (e) { console.warn('TF.ensureUntiedLabels:', e && e.message); }
    }

    /* ----- #3 : plan de charge (heures par personne) ------------------------
     * Stockage : colonne Text `charges` sur Tasks, JSON [{teamId, heures}].
     * Parse defensif identique au pattern subtasks.
     * --------------------------------------------------------------------- */
    function parseCharges(v) {
        try {
            const a = JSON.parse(v || '[]');
            if (!Array.isArray(a)) return [];
            return a.filter(x => x && x.teamId != null)
                    .map(x => ({ teamId: Number(x.teamId), heures: Number(x.heures) || 0 }))
                    .filter(x => !isNaN(x.teamId));
        } catch (e) { return []; }
    }
    function chargesToJson(arr) {
        return JSON.stringify((arr || [])
            .filter(x => x && x.teamId != null)
            .map(x => ({ teamId: Number(x.teamId), heures: Number(x.heures) || 0 }))
            .filter(x => !isNaN(x.teamId)));
    }
    // Heures totales d'une tache (somme des charges par personne).
    function chargeTotal(charges) { return parseCharges(typeof charges === 'string' ? charges : JSON.stringify(charges || [])).reduce((s, c) => s + c.heures, 0); }
    // Agrege la charge par membre sur une liste de taches (chaque tache expose .charges).
    function chargeByMember(tasks) {
        const by = {};
        for (const t of (tasks || [])) {
            for (const c of parseCharges(t && t.charges)) {
                by[c.teamId] = (by[c.teamId] || 0) + c.heures;
            }
        }
        return by;
    }

    // Cle de periode : semaine ISO 'YYYY-Www' ou mois 'YYYY-MM'.
    function periodKey(date, granularity) {
        if (granularity === 'month') {
            return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
        }
        const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
    }

    // #3 plan de charge temporel : etale les charges PROPRES de chaque tache sur sa
    // duree (jours calendaires), agrege par personne et par periode.
    // dateDebut/dateEcheance = timestamps Unix SECONDES (Grist). Tache sans dates ou
    // sans charge = ignoree. Retourne { teamId: { periodKey: heures } }.
    function chargeByMemberPeriod(tasks, granularity) {
        const g = granularity === 'month' ? 'month' : 'week';
        const out = {};
        for (const t of (tasks || [])) {
            const charges = parseCharges(t && t.charges);
            if (!charges.length) continue;
            const s = t.dateDebut, e = t.dateEcheance;
            if (s == null || e == null) continue;
            const day0 = Math.floor((s * 1000) / 86400000);
            const day1 = Math.floor((e * 1000) / 86400000);
            const nDays = Math.max(day1 - day0 + 1, 1);
            for (const c of charges) {
                const perDay = (Number(c.heures) || 0) / nDays;
                if (!perDay) continue;
                if (!out[c.teamId]) out[c.teamId] = {};
                for (let dd = day0; dd <= day1; dd++) {
                    const key = periodKey(new Date(dd * 86400000), g);
                    out[c.teamId][key] = (out[c.teamId][key] || 0) + perDay;
                }
            }
        }
        return out;
    }

    // Decale une date de n periodes (semaine = 7 jours, mois = 1 mois).
    function shiftPeriods(date, granularity, n) {
        const d = new Date(date.getTime());
        if (granularity === 'month') d.setUTCMonth(d.getUTCMonth() + n);
        else d.setUTCDate(d.getUTCDate() + n * 7);
        return d;
    }

    // Liste contigue de cles de periode (semaine ISO ou mois) a partir d'une date,
    // alignee sur le debut de periode (lundi / 1er du mois). Inclut les periodes vides.
    function periodRange(startDate, granularity, count) {
        const g = granularity === 'month' ? 'month' : 'week';
        let d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
        if (g === 'week') { const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() - day + 1); }
        else { d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
        const out = [];
        for (let i = 0; i < count; i++) {
            out.push(periodKey(d, g));
            if (g === 'week') d.setUTCDate(d.getUTCDate() + 7);
            else d.setUTCMonth(d.getUTCMonth() + 1);
        }
        return out;
    }

    // chargeMatrix : generalise chargeByMemberPeriod. Etale les charges (via getCharges,
    // defaut parseCharges) sur la duree, agrege par cle keyFn(t, charge) et periode.
    function chargeMatrix(tasks, keyFn, granularity, getCharges, workdays) {
        const g = granularity === 'month' ? 'month' : 'week';
        const out = {};
        for (const t of (tasks || [])) {
            const charges = getCharges ? getCharges(t) : parseCharges(t && t.charges);
            if (!charges.length || t.dateDebut == null || t.dateEcheance == null) continue;
            const d0 = Math.floor((t.dateDebut * 1000) / 86400000), d1 = Math.floor((t.dateEcheance * 1000) / 86400000);
            const days = [];
            for (let dd = d0; dd <= d1; dd++) { if (workdays) { const wd = new Date(dd * 86400000).getUTCDay(); if (wd < 1 || wd > 5) continue; } days.push(dd); }
            if (!days.length) days.push(d0);
            for (const c of charges) {
                const key = keyFn(t, c); if (key == null) continue;
                const perDay = c.heures / days.length; if (!perDay) continue;
                if (!out[key]) out[key] = {};
                for (const dd of days) { const pk = periodKey(new Date(dd * 86400000), g); out[key][pk] = (out[key][pk] || 0) + perDay; }
            }
        }
        return out;
    }

    /* ----- Timeline Gantt : calcul pur de l'echelle -------------------------
     * Extrait de gantt.html (computeEffectiveRange) pour etre partage avec le
     * Gantt de fiche. Aucun effet de bord (ni etat, ni DOM) : rend les nombres,
     * l'appelant les applique. Math des dates repliquee a l'identique.
     * Entree : { tasks:[{start:Date|null,end:Date|null}], unit:'day'|'week'|'month',
     *   cellWidth:number, viewStart:Date, viewDays:number, availableWidth:number,
     *   extendLeft?:boolean }
     * extendLeft a false fige le debut de plage sur viewStart : les vues glissantes s'y
     * ancrent pour tenir la ligne du jour au bord, les barres anterieures restent tronquees
     * a gauche par computeBarGeometry.
     * Sortie : { effectiveStart:Date, effectiveDays, numCells, cellWidth, pxPerDay }
     * --------------------------------------------------------------------- */
    function computeTimelineScale(opts) {
        const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
        const daysDiff = (a, b) => Math.round((b - a) / 86400000);
        const startOfWeek = (d) => { const r = new Date(d); const day = r.getDay(); r.setDate(r.getDate() - day + (day === 0 ? -6 : 1)); r.setHours(0, 0, 0, 0); return r; };
        const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

        const unit = opts.unit, viewStart = opts.viewStart, viewDays = opts.viewDays;
        let eStart = new Date(viewStart.getTime());
        let eEnd = addDays(viewStart, viewDays);
        const vEnd = new Date(eEnd.getTime());
        const PADDING = unit === 'day' ? 3 : unit === 'week' ? 7 : 14;
        for (const t of (opts.tasks || [])) {
            const ts = t.start, te = t.end;
            if (!ts || !te) continue;
            if (!isPlausibleDate(ts) || !isPlausibleDate(te)) continue;
            if (te < viewStart || ts > vEnd) continue;
            if (ts < eStart && opts.extendLeft !== false) eStart = addDays(ts, -PADDING);
            if (te > eEnd) eEnd = addDays(te, PADDING);
        }
        if (unit === 'week') eStart = startOfWeek(eStart);
        else if (unit === 'month') eStart = startOfMonth(eStart);
        else eStart = new Date(eStart.getFullYear(), eStart.getMonth(), eStart.getDate());

        const effectiveDays = Math.max(daysDiff(eStart, eEnd), viewDays);
        let numCells;
        if (unit === 'month') {
            const eEnd2 = addDays(eStart, effectiveDays);
            numCells = Math.max(1, (eEnd2.getFullYear() - eStart.getFullYear()) * 12 + (eEnd2.getMonth() - eStart.getMonth()));
        } else if (unit === 'week') {
            numCells = Math.ceil(effectiveDays / 7);
        } else {
            numCells = effectiveDays;
        }
        const effCellWidth = Math.max(opts.cellWidth, Math.floor(opts.availableWidth / numCells));
        const pxPerDay = effectiveDays > 0 ? (numCells * effCellWidth) / effectiveDays : opts.cellWidth;
        return { effectiveStart: eStart, effectiveDays: effectiveDays, numCells: numCells, cellWidth: effCellWidth, pxPerDay: pxPerDay };
    }

    /* Géométrie d'une barre / d'un jalon sur la timeline (pur). Reprend le clamping
     * exact de gantt.html : plancher de largeur, décalage du diamant. Partagé avec le lite.
     * Entrée : { start:Date, tStart:Date, tEnd:Date, pxPerDay:number }
     * Sortie : { left, width, barLeft, barWidth, isNarrow, diamondLeft } (px)
     */
    function computeBarGeometry(o) {
        const daysDiff = (a, b) => Math.round((b - a) / 86400000);
        const startOffset = daysDiff(o.start, o.tStart);
        const duration = Math.max(daysDiff(o.tStart, o.tEnd) + 1, 1);
        const left = Math.round(startOffset * o.pxPerDay);
        const width = Math.round(duration * o.pxPerDay);
        const barLeft = Math.max(0, left);
        const barWidth = Math.max(width - (barLeft - left), 12);
        const diamondLeft = Math.max(0, left + Math.round(o.pxPerDay / 2) - 7);
        return { left: left, width: width, barLeft: barLeft, barWidth: barWidth, isNarrow: barWidth < 60, diamondLeft: diamondLeft };
    }

    /* Une date de tâche hors de ces bornes ne vient pas d'une saisie aboutie : avant 2000
     * c'est une valeur non renseignée (epoch 0 = 01/01/1970), au-delà de 2200 une frappe en
     * cours. Un `input type="date"` émet un change à chaque chiffre de l'année, donc saisir
     * 2027 passe par les années 2, 20 et 202 : laisser filer ces dates étend la plage de la
     * timeline sur des milliers d'années, soit autant de cellules à construire.
     */
    const ANNEE_MIN = 2000;
    const ANNEE_MAX = 2200;

    function isPlausibleDate(d) {
        if (!d) return false;
        const date = d instanceof Date ? d : new Date(d);
        const annee = date.getFullYear();
        return !isNaN(annee) && annee >= ANNEE_MIN && annee <= ANNEE_MAX;
    }

    /* Défilement horizontal à poser à l'ouverture pour amener la ligne « aujourd'hui »
     * près du bord gauche (pur). On cale le début de la sur-colonne qui contient
     * aujourd'hui (le mois, ou l'année en vue Année), sauf si cela laisse la ligne
     * au-delà du premier tiers de la zone visible : au-delà, on décale juste ce qu'il
     * faut pour l'y ramener, sinon les vues à grosses sur-colonnes envoient aujourd'hui
     * hors de l'écran sur les fenêtres étroites.
     * Entrée : { colPx, todayPx, visibleWidth, ecart? }
     * Sortie : défilement souhaité en px (>= 0), avant clamp du navigateur
     */
    function computeTodayScroll(o) {
        const ecart = o.ecart == null ? 12 : o.ecart;
        const seuil = Math.max(ecart, o.visibleWidth / 3);
        let scroll = o.colPx - ecart;
        if (o.todayPx - scroll > seuil) scroll = o.todayPx - seuil;
        return Math.max(0, Math.round(scroll));
    }

    /* Tracé d'une flèche de dépendance entre deux tâches (pur). Reprend la géométrie
     * exacte de gantt.html : centre de ligne (hauteur 44, +22), courbe de Bézier, flèche.
     * Entrée : { start:Date, depEnd:Date, tStart:Date, depIdx, tIdx, pxPerDay }
     * Sortie : { x1, y1, x2, y2, midX, pathD, arrowPoints }
     */
    function computeDependencyPath(o) {
        const daysDiff = (a, b) => Math.round((b - a) / 86400000);
        const x1 = daysDiff(o.start, o.depEnd) * o.pxPerDay + o.pxPerDay;
        const y1 = o.depIdx * 44 + 22;
        const x2 = daysDiff(o.start, o.tStart) * o.pxPerDay;
        const y2 = o.tIdx * 44 + 22;
        const midX = (x1 + x2) / 2;
        return {
            x1: x1, y1: y1, x2: x2, y2: y2, midX: midX,
            pathD: 'M' + x1 + ',' + y1 + ' C' + midX + ',' + y1 + ' ' + midX + ',' + y2 + ' ' + x2 + ',' + y2,
            arrowPoints: x2 + ',' + y2 + ' ' + (x2 - 6) + ',' + (y2 - 4) + ' ' + (x2 - 6) + ',' + (y2 + 4)
        };
    }

    return {
        DEFAULT_STATUSES: DEFAULT_STATUSES,
        computeTimelineScale: computeTimelineScale,
        computeBarGeometry: computeBarGeometry,
        computeDependencyPath: computeDependencyPath,
        computeTodayScroll: computeTodayScroll,
        isPlausibleDate: isPlausibleDate,
        columnarToRows: columnarToRows,
        fetchSchemaMeta: fetchSchemaMeta,
        loadStatusConfig: loadStatusConfig,
        buildStatusConfig: buildStatusConfig,
        getStatus: getStatus,
        isTerminal: isTerminal,
        seedStatusChoices: seedStatusChoices,
        setRefDisplayColumns: setRefDisplayColumns,
        ensureUntiedLabels: ensureUntiedLabels,
        parseCharges: parseCharges,
        chargesToJson: chargesToJson,
        chargeTotal: chargeTotal,
        chargeByMember: chargeByMember,
        periodKey: periodKey,
        chargeByMemberPeriod: chargeByMemberPeriod,
        shiftPeriods: shiftPeriods,
        periodRange: periodRange,
        chargeMatrix: chargeMatrix
    };
})();

// Export Node pour les tests. Inerte dans le navigateur, ou `module` n'existe pas.
if (typeof module !== 'undefined' && module.exports) module.exports = TF;
