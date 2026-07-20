'use strict';

/* Simulacre de l'API Grist plugin, adosse a un document en memoire.
 * Fidelites exigees, relevees sur le code reel des widgets :
 *   - fetchTable LEVE sur table inconnue (ensureSchema s'en sert pour detecter l'absence)
 *   - fetchTable rend le format colonnaire, toutes colonnes declarees presentes
 *   - _grist_Tables et _grist_Tables_column suivent les tables applicatives
 * Divergences connues avec grist.numerique.gouv.fr : voir docs/infra-de-test.md.
 */

const TABLES_META = ['_grist_Tables', '_grist_Tables_column'];

function createFakeGrist(documentInitial) {
    const doc = {};
    const refTable = {};       // tableId -> ref numerique
    const refColonne = {};     // tableId -> { colId -> ref numerique }
    let prochainRefTable = 1;
    let prochainRefColonne = 1;

    function declarerTable(tableId, colonnes, enregistrements) {
        doc[tableId] = { columns: {}, records: enregistrements || [] };
        refTable[tableId] = prochainRefTable++;
        refColonne[tableId] = {};
        for (const colId of Object.keys(colonnes || {})) declarerColonne(tableId, colId, colonnes[colId]);
    }

    function declarerColonne(tableId, colId, info) {
        doc[tableId].columns[colId] = Object.assign({ type: 'Any' }, info || {});
        refColonne[tableId][colId] = prochainRefColonne++;
    }

    for (const tableId of Object.keys(documentInitial || {})) {
        const t = documentInitial[tableId];
        declarerTable(tableId, t.columns, (t.records || []).map((r) => Object.assign({}, r)));
    }

    function versColonnaire(enregistrements, colIds) {
        const out = { id: enregistrements.map((r) => r.id) };
        for (const colId of colIds) {
            out[colId] = enregistrements.map((r) => (colId in r ? r[colId] : null));
        }
        return out;
    }

    function lignesMetaTables() {
        return Object.keys(doc).map((tableId) => ({ id: refTable[tableId], tableId: tableId }));
    }

    function lignesMetaColonnes() {
        const lignes = [];
        for (const tableId of Object.keys(doc)) {
            for (const colId of Object.keys(doc[tableId].columns)) {
                const info = doc[tableId].columns[colId];
                lignes.push({
                    id: refColonne[tableId][colId],
                    parentId: refTable[tableId],
                    colId: colId,
                    type: info.type,
                    widgetOptions: info.widgetOptions != null ? info.widgetOptions : '',
                    visibleCol: info.visibleCol != null ? info.visibleCol : 0
                });
            }
        }
        return lignes;
    }

    async function fetchTable(nom) {
        if (nom === '_grist_Tables') {
            return versColonnaire(lignesMetaTables(), ['tableId']);
        }
        if (nom === '_grist_Tables_column') {
            return versColonnaire(lignesMetaColonnes(), ['parentId', 'colId', 'type', 'widgetOptions', 'visibleCol']);
        }
        if (!doc[nom]) throw new Error('Table inconnue: ' + nom);
        return versColonnaire(doc[nom].records, Object.keys(doc[nom].columns));
    }

    async function listTables() {
        return Object.keys(doc).filter((t) => TABLES_META.indexOf(t) === -1);
    }

    const journal = [];
    let prochainId = {};
    for (const tableId of Object.keys(doc)) {
        prochainId[tableId] = doc[tableId].records.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    }

    function table(tableId) {
        if (!doc[tableId]) throw new Error('Table inconnue: ' + tableId);
        return doc[tableId];
    }

    function appliquer(action) {
        const type = action[0];

        if (type === 'AddTable') {
            const colonnes = {};
            for (const c of action[2] || []) colonnes[c.id] = { type: c.type || 'Any' };
            declarerTable(action[1], colonnes, []);
            prochainId[action[1]] = 1;
            return null;
        }
        if (type === 'AddColumn') {
            declarerColonne(action[1], action[2], action[3]);
            return null;
        }
        if (type === 'ModifyColumn') {
            const colonne = table(action[1]).columns[action[2]];
            if (!colonne) throw new Error('Colonne inconnue: ' + action[1] + '.' + action[2]);
            Object.assign(colonne, action[3] || {});
            return null;
        }
        if (type === 'SetDisplayFormula') {
            // Signature reelle : ['SetDisplayFormula', tableId, null, colRef, formule].
            // Aucun widget n'exploite l'effet, on se contente de journaliser.
            return null;
        }
        if (type === 'AddRecord') {
            const t = table(action[1]);
            const id = action[2] != null ? action[2] : prochainId[action[1]]++;
            t.records.push(Object.assign({ id: id }, action[3] || {}));
            return id;
        }
        if (type === 'BulkAddRecord') {
            const t = table(action[1]);
            const valeurs = action[3] || {};
            const colIds = Object.keys(valeurs);
            const n = colIds.length ? valeurs[colIds[0]].length : (action[2] || []).length;
            const ids = [];
            for (let i = 0; i < n; i++) {
                const rec = { id: prochainId[action[1]]++ };
                for (const colId of colIds) rec[colId] = valeurs[colId][i];
                t.records.push(rec);
                ids.push(rec.id);
            }
            return ids;
        }
        if (type === 'UpdateRecord') {
            const t = table(action[1]);
            const rec = t.records.find((r) => r.id === action[2]);
            if (!rec) throw new Error('Enregistrement inconnu: ' + action[1] + '#' + action[2]);
            Object.assign(rec, action[3] || {});
            return null;
        }
        if (type === 'RemoveRecord') {
            const t = table(action[1]);
            const index = t.records.findIndex((r) => r.id === action[2]);
            if (index === -1) throw new Error('Enregistrement inconnu: ' + action[1] + '#' + action[2]);
            t.records.splice(index, 1);
            return null;
        }
        throw new Error('Action non geree par le simulacre: ' + type);
    }

    async function applyUserActions(actions) {
        const retValues = [];
        for (const action of actions || []) {
            journal.push(action);
            retValues.push(appliquer(action));
        }
        return { retValues: retValues };
    }

    return {
        docApi: { fetchTable: fetchTable, listTables: listTables, applyUserActions: applyUserActions },
        _doc: doc,
        _log: journal,
        _refTable: refTable,
        _refColonne: refColonne,
        _declarerTable: declarerTable,
        _declarerColonne: declarerColonne
    };
}

module.exports = { createFakeGrist };
