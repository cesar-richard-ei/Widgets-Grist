/* ============================================================================
 * arbre.js — Hierarchie des taches, module du cœur TaskFlow
 * ----------------------------------------------------------------------------
 * SOURCE UNIQUE, inlinee par scripts/build-inline.js dans les seuls widgets qui
 * affichent un arbre : gantt, kanban, calendar, dashboard. Le plan, la fiche et
 * le tableau blanc ne la portent pas.
 *
 * Se greffe sur TF : le marqueur doit donc venir APRES celui du cœur.
 * ========================================================================== */
(function () {
    'use strict';

/* ----- Hierarchie des taches -------------------------------------------
 * Une tache peut en contenir d'autres, par `parentTask`. Quatre widgets en
 * avaient chacun leur copie, aux memes bugs pres.
 *
 * Les cycles ne sont pas theoriques : sur le document du metier, les
 * identifiants de Tasks et de Chantiers se recouvrent, et un parentTask
 * repointe rattachait 41 taches sur 79 a une autre tache. L'index les
 * ecarte a la construction plutot que de s'en proteger a chaque parcours.
 * --------------------------------------------------------------------- */
function construireArbre(taches) {
    const liste = Array.isArray(taches) ? taches : [];
    const parId = new Map();
    for (const t of liste) if (t && t.id != null) parId.set(t.id, t);

    // Une tache dont la chaine de parents boucle : elle reste affichee, mais
    // n'est rattachee a personne.
    const cycles = new Set();
    for (const t of liste) {
        const vus = new Set([t.id]);
        let cur = t.parentTask ? parId.get(t.parentTask) : null;
        let garde = 0;
        while (cur && garde++ < 128) {
            if (vus.has(cur.id)) { cycles.add(t.id); break; }
            vus.add(cur.id);
            cur = cur.parentTask ? parId.get(cur.parentTask) : null;
        }
    }

    const parParent = new Map();
    for (const t of liste) {
        const pid = t.parentTask;
        if (!pid || isNaN(pid) || cycles.has(t.id)) continue;
        if (!parParent.has(pid)) parParent.set(pid, []);
        parParent.get(pid).push(t);
    }

    const enfants = (id) => parParent.get(id) || [];
    const aDesEnfants = (t) => !!t && enfants(t.id).length > 0;
    const parent = (t) => (t && t.parentTask ? parId.get(t.parentTask) : null) || null;

    function descendants(id, acc, vus) {
        acc = acc || []; vus = vus || new Set();
        if (vus.has(id)) return acc;
        vus.add(id);
        for (const k of enfants(id)) { acc.push(k); descendants(k.id, acc, vus); }
        return acc;
    }

    function profondeur(t) {
        let d = 0, cur = t, garde = 0;
        while (cur && cur.parentTask && garde++ < 128) { cur = parId.get(cur.parentTask); if (cur) d++; }
        return d;
    }

    // Rattacher une tache a l'un de ses propres descendants formerait une boucle.
    function peutAvoirPourParent(id, nouveauParent) {
        if (!nouveauParent) return true;
        if (nouveauParent === id) return false;
        let cur = parId.get(nouveauParent), garde = 0;
        while (cur && garde++ < 128) {
            if (cur.id === id) return false;
            cur = cur.parentTask ? parId.get(cur.parentTask) : null;
        }
        return true;
    }

    /* Progression d'un parent : moyenne de ses enfants, ponderee par
     * l'estimation quand ils en portent tous une. Jamais persistee. */
    function progression(t, vus) {
        vus = vus || new Set();
        if (!t || vus.has(t.id)) return (t && t.progression) || 0;
        vus.add(t.id);
        const kids = enfants(t.id);
        if (!kids.length) return t.progression || 0;
        const tousEstimes = kids.every(k => k.estimationH && k.estimationH > 0);
        if (tousEstimes) {
            const total = kids.reduce((s, k) => s + k.estimationH, 0);
            return Math.round(kids.reduce((s, k) => s + progression(k, vus) * k.estimationH, 0) / total);
        }
        return Math.round(kids.reduce((s, k) => s + progression(k, vus), 0) / kids.length);
    }

    /* Bornes d'un parent : les siennes, elargies par celles de ses
     * descendants. Les dates propres restent prioritaires, un parent pouvant
     * reserver une plage plus large que ses enfants. */
    function bornes(t, vus) {
        vus = vus || new Set();
        if (!t || vus.has(t.id)) return { start: t && t.dateDebut, end: t && t.dateEcheance };
        vus.add(t.id);
        const kids = enfants(t.id);
        if (!kids.length) return { start: t.dateDebut, end: t.dateEcheance };
        let min = t.dateDebut, max = t.dateEcheance;
        for (const k of kids) {
            const sous = bornes(k, vus);
            if (sous.start != null && (min == null || sous.start < min)) min = sous.start;
            if (sous.end != null && (max == null || sous.end > max)) max = sous.end;
        }
        return { start: min, end: max };
    }

    /* Parcours en profondeur, dans l'ordre d'affichage. Iteratif : une
     * hierarchie profonde ferait deborder la pile. */
    function parcourir(racines, cb) {
        const pile = (racines || []).slice().reverse().map(r => ({ tache: r, profondeur: 0 }));
        while (pile.length) {
            const { tache, profondeur: d } = pile.pop();
            cb(tache, d);
            const kids = enfants(tache.id);
            for (let i = kids.length - 1; i >= 0; i--) pile.push({ tache: kids[i], profondeur: d + 1 });
        }
    }

    return {
        cycles: cycles,
        tache: (id) => parId.get(id) || null,
        enfants: enfants,
        aDesEnfants: aDesEnfants,
        parent: parent,
        descendants: (id) => descendants(id),
        profondeur: profondeur,
        peutAvoirPourParent: peutAvoirPourParent,
        progression: (t) => progression(t),
        bornes: (t) => bornes(t),
        parcourir: parcourir
    };
}

    // Greffe sur le cœur, inliné juste au-dessus. Hors navigateur, TF n'existe pas.
    if (typeof TF !== 'undefined') TF.construireArbre = construireArbre;
    // Export Node pour les tests. Inerte dans le navigateur, ou `module` n'existe pas.
    if (typeof module !== 'undefined' && module.exports) module.exports = { construireArbre: construireArbre };
})();
