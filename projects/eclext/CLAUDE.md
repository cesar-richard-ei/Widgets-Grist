# Projet : EclExt — Éclairage Public (CNIG)

## Contexte

Widget Grist de gestion / simulation de l'**éclairage public** conforme au
standard **CNIG EclExt v1.1**. Carte MapLibre + fonds IGN (Géoplateforme),
relief LIDAR HD, rendu 3D des luminaires (cônes lumineux + modèles GLB),
simulation horaire jour/nuit (SunCalc) et profils nocturnes (allumage,
extinction, variations de puissance/flux/température).

Fichier unique autonome : `index.html` (widget statique). Fonctionne dans
Grist (`requiredAccess: full`, crée les tables) ou en **mode démo** standalone.

## Architecture

- Carte MapLibre, fonds IGN WMTS (Plan / Ortho / « Sombre »).
- Terrain : MNT LIDAR HD IGN (WMS GeoTIFF Float32) décodé en TerrainRGB via
  un **protocole `float32dem://`**.
- 3D : `LuminaireCustomLayer` (custom layer three.js r128) en **InstancedMesh**
  (3 draw calls : cônes / disques sol / cônes ULR) + GLB individuels
  viewport-culled.
- Données CNIG : tables `Modeles_Luminaires`, `ProfilNocturne`,
  `PlageVariation`, `PointLumineux`.
- Modules (toolbar) : Données · Profils · Rendu · Modèles · Saisie · Carte.

## Optimisations appliquées (vs version d'origine)

1. **Terrain hors thread principal** : décodage GeoTIFF→TerrainRGB dans un
   **pool de Web Workers** (`makeTerrainDecoderPool`, worker inline en Blob).
   Et **source DEM unique** partagée terrain + hillshade (avant : 2 sources →
   décodage en double).
2. **Slider temps sans re-clustering** : `onTimeChange` met à jour les couleurs
   3D immédiatement (fast path) et **débounce** le `setData` 2D
   (`scheduleRender2D`, 90 ms) pour ne pas re-clusteriser à chaque tick.
3. **Pan sans terrain = pas de recalcul** : `onMapMoveEnd` ne rappelle
   `updateAll` (matrices) que si le relief 3D est actif (sinon invariant au pan).
4. **Fuite VRAM corrigée** : `_applyGLBEmissive` clone le matériau **une seule
   fois** (flag `_eclextCloned`) puis ne fait que muter `emissive`/intensité.
5. **Conformité plages** : `computeIntensity` gère `%` et `VA` (valeur absolue,
   P→puissance, F→flux) ; `getActiveKelvin` applique les plages **TC**
   (température de couleur). Support de plages multiples simultanées
   (`getActivePlages`).
6. `WebGLRenderer.dispose()` à `onRemove`.
7. **XSS** : helper `esc()` appliqué à toute donnée Grist injectée en
   `innerHTML` / attribut `value`.
8. `grist.onRecords` **débounce** (400 ms) → plus de rechargement des 4 tables
   à chaque frappe.
9. Imports OSM/CSV/GeoJSON en **`BulkAddRecord`** (`bulkAddPoints`) au lieu d'un
   `AddRecord` par point.
10. **Responsive** : sur conteneur étroit, panneau plein écran + toolbar
    défilable. Nettoyage code mort.

## Points d'attention / limites

- **three.js r128** conservé (build UMD + `examples/js/GLTFLoader.js` global).
  Migration vers une version maintenue = passage en ESM/importmap (changerait
  le pattern global). À faire ultérieurement si besoin.
- `addProtocol` workers : `importScripts` charge geotiff depuis le CDN ;
  `OffscreenCanvas`/`convertToBlob` requis (Chrome/Edge/Firefox, Safari ≥ 16.4).
  Repli tuile plate si décodage échoue.
- Cônes lumineux en `depthTest:false` (non occultés par le relief/bâti) — choix
  visuel d'origine conservé.
- **Non testé en navigateur réel** dans l'environnement de dev (pas de
  navigateur headless) : valider le rendu WebGL, le décodage MNT et l'intégration
  Grist en conditions réelles.

## Publication

Non publié. Pour publier : `published/eclext/` + `package.json` (section
`grist`, `accessLevel: full`) + copie de `index.html`, puis `npm run manifest`.
