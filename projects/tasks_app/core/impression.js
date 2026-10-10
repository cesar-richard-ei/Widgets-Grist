/* ============================================================================
 * impression.js : mise à l'échelle de la fiche imprimée, module du cœur TaskFlow
 * ----------------------------------------------------------------------------
 * SOURCE UNIQUE, inlinee par scripts/build-inline.js dans la seule fiche.
 *
 * Se greffe sur TF : le marqueur doit donc venir APRES celui du cœur.
 * ========================================================================== */
(function () {
    'use strict';

    const PASSES = 6;
    const PLANCHER = 0.2;

    // Mise en page sur largeur / zoom puis réduite par zoom : la fiche occupe toute la largeur de la page.
    function echelleDImpression(o) {
        const passes = o.passes || PASSES;
        const tient = (z) => o.mesurer(o.largeur / z) * z <= o.hauteur;
        const pleine = o.mesurer(o.largeur);
        if (pleine <= o.hauteur) return { largeur: o.largeur, zoom: 1 };
        let bas = o.hauteur / pleine;
        while (bas > PLANCHER && !tient(bas)) bas *= 0.9;
        let haut = 1;
        for (let i = 0; i < passes; i++) {
            const z = (bas + haut) / 2;
            if (tient(z)) bas = z; else haut = z;
        }
        return { largeur: o.largeur / bas, zoom: bas };
    }

    // Greffe sur le cœur, inliné juste au-dessus. Hors navigateur, TF n'existe pas.
    if (typeof TF !== 'undefined') Object.assign(TF, { echelleDImpression: echelleDImpression });
    // Export Node pour les tests. Inerte dans le navigateur, ou `module` n'existe pas.
    if (typeof module !== 'undefined' && module.exports) module.exports = { echelleDImpression: echelleDImpression };
})();
