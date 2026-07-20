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
    // let plutot que const : appliquer() referme sur ces noms de variables,
    // un lot d'actions transactionnel doit pouvoir les reaffecter en bloc (voir applyUserActions).
    let doc = {};
    let refTable = {};       // tableId -> ref numerique
    let refColonne = {};     // tableId -> { colId -> ref numerique }
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

    // Attribue l'identifiant d'un nouvel enregistrement. Un identifiant explicite
    // fait avancer prochainId comme le ferait un vrai document Grist, et une collision
    // avec un enregistrement existant leve : un document reel ne peut pas porter deux
    // lignes de meme id.
    function attribuerId(tableId, t, idDemande) {
        if (idDemande == null) return prochainId[tableId]++;
        if (t.records.some((r) => r.id === idDemande)) {
            throw new Error('Identifiant deja utilise: ' + tableId + '#' + idDemande);
        }
        if (idDemande >= prochainId[tableId]) prochainId[tableId] = idDemande + 1;
        return idDemande;
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
            table(action[1]);
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
            const id = attribuerId(action[1], t, action[2]);
            t.records.push(Object.assign({ id: id }, action[3] || {}));
            return id;
        }
        if (type === 'BulkAddRecord') {
            const t = table(action[1]);
            const valeurs = action[3] || {};
            const colIds = Object.keys(valeurs);
            const idsDemandes = action[2] || [];
            const n = colIds.length ? valeurs[colIds[0]].length : idsDemandes.length;
            const ids = [];
            for (let i = 0; i < n; i++) {
                const id = attribuerId(action[1], t, idsDemandes[i]);
                const rec = { id: id };
                for (const colId of colIds) rec[colId] = valeurs[colId][i];
                t.records.push(rec);
                ids.push(id);
            }
            return ids;
        }
        if (type === 'UpdateRecord' && action[1] === '_grist_Tables_column') {
            // Les widgets posent visibleCol par une mise a jour de la table de metadonnees.
            for (const tableId of Object.keys(refColonne)) {
                for (const colId of Object.keys(refColonne[tableId])) {
                    if (refColonne[tableId][colId] === action[2]) {
                        Object.assign(doc[tableId].columns[colId], action[3] || {});
                        return null;
                    }
                }
            }
            // Un vrai document Grist refuse une mise a jour sur une reference de colonne
            // qui n'existe pas ; rester coherent avec UpdateRecord sur les tables applicatives,
            // qui leve deja dans ce cas (cf. plus bas).
            throw new Error('Enregistrement inconnu: _grist_Tables_column#' + action[2]);
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
        // Un lot est transactionnel, comme applyUserActions sur un vrai document Grist :
        // instantane avant d'appliquer, restauration integrale si une action leve, et le
        // journal ne recoit les actions que si le lot entier a reussi.
        const instantane = structuredClone({ doc: doc, refTable: refTable, refColonne: refColonne, prochainId: prochainId });
        const retValues = [];
        try {
            for (const action of actions || []) {
                retValues.push(appliquer(action));
            }
        } catch (e) {
            doc = instantane.doc;
            refTable = instantane.refTable;
            refColonne = instantane.refColonne;
            prochainId = instantane.prochainId;
            throw e;
        }
        for (const action of actions || []) journal.push(action);
        return { retValues: retValues };
    }

    return {
        docApi: { fetchTable: fetchTable, listTables: listTables, applyUserActions: applyUserActions },
        // Accesseurs plutot que proprietes figees : un rollack de lot reaffecte
        // doc/refTable/refColonne (voir applyUserActions), l'expose doit suivre l'etat courant.
        get _doc() { return doc; },
        _log: journal,
        get _refTable() { return refTable; },
        get _refColonne() { return refColonne; },
        _declarerTable: declarerTable,
        _declarerColonne: declarerColonne
    };
}

module.exports = { createFakeGrist };
