/* ============================================================================
 * visionneuse.js : zoom et déplacement du visuel agrandi, module du cœur TaskFlow
 * ----------------------------------------------------------------------------
 * SOURCE UNIQUE, inlinee par scripts/build-inline.js dans la seule fiche.
 *
 * Se greffe sur TF : le marqueur doit donc venir APRES celui du cœur.
 * ========================================================================== */
(function () {
    'use strict';

    const ZOOM_MAX = 5;

    function ajusterVisuel(cadre, image) {
        const echelle = Math.min(cadre.largeur / image.largeur, cadre.hauteur / image.hauteur);
        return {
            echelle: echelle,
            x: (cadre.largeur - image.largeur * echelle) / 2,
            y: (cadre.hauteur - image.hauteur * echelle) / 2
        };
    }

    // Plus petite que le cadre, l'image y reste centrée ; plus grande, elle n'en découvre jamais le bord.
    function borner(position, taille, cadre) {
        if (taille <= cadre) return (cadre - taille) / 2;
        return Math.min(0, Math.max(cadre - taille, position));
    }

    function bornerVisuel(etat, cadre, image) {
        return {
            echelle: etat.echelle,
            x: borner(etat.x, image.largeur * etat.echelle, cadre.largeur),
            y: borner(etat.y, image.hauteur * etat.echelle, cadre.hauteur)
        };
    }

    function zoomerVisuel(etat, facteur, point, cadre, image) {
        const ajuste = ajusterVisuel(cadre, image).echelle;
        const echelle = Math.min(ajuste * ZOOM_MAX, Math.max(ajuste, etat.echelle * facteur));
        const r = echelle / etat.echelle;
        return bornerVisuel({ echelle: echelle, x: point.x - (point.x - etat.x) * r, y: point.y - (point.y - etat.y) * r }, cadre, image);
    }

    function deplacerVisuel(etat, dx, dy, cadre, image) {
        return bornerVisuel({ echelle: etat.echelle, x: etat.x + dx, y: etat.y + dy }, cadre, image);
    }

    const api = { ajusterVisuel: ajusterVisuel, zoomerVisuel: zoomerVisuel, deplacerVisuel: deplacerVisuel };
    // Greffe sur le cœur, inliné juste au-dessus. Hors navigateur, TF n'existe pas.
    if (typeof TF !== 'undefined') Object.assign(TF, api);
    // Export Node pour les tests. Inerte dans le navigateur, ou `module` n'existe pas.
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
