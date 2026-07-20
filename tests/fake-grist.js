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

    return {
        docApi: { fetchTable: fetchTable, listTables: listTables },
        _doc: doc,
        _refTable: refTable,
        _refColonne: refColonne,
        _declarerTable: declarerTable,
        _declarerColonne: declarerColonne
    };
}

module.exports = { createFakeGrist };
