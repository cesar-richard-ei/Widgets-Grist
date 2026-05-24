# Projet : Atlas — Atlas (Maquette 3D Territoriale)

## Contexte

Refonte UX/UI complète du widget « Maquette 3D Territoriale » pour Grist,
issue du design canvas Claude Design (`carte-grist`, direction **Atlas**).

Cible : élus / présentations publiques, mais la tâche n°1 reste **construire**
la maquette (import de données, édition, symbolisation, placement de modèles 3D).

Différence majeure avec l'ancien widget : **Mapbox a été remplacé par MapLibre
GL JS**, et les modèles 3D GLTF (qui s'appuyaient sur la couche `model` native
de Mapbox Standard) sont désormais rendus via une **custom layer three.js**.

## Architecture des fichiers

```
Atlas/
├── index.html   # Chrome Atlas (HTML/CSS) + structure du DOM
├── app.js       # Toute la logique (ES module)
└── CLAUDE.md
```

- `index.html` : design **Atlas** (papier `#F4EFE3`, serif Newsreader + Hanken
  Grotesk, accent terre cuite `#C44536`). Header + rail d'icônes (6 modules) +
  panneau de module contextuel (gauche) + carte + inspecteur (droite) +
  overlays carte (boussole, HUD, légende, bandeau solaire, barre de sélection).
- `app.js` (module, importe `three` + `GLTFLoader` via importmap) : état,
  carte MapLibre, custom layer 3D, modules, symbolisation, sélection, import
  OSM/fichier, persistance Grist, sauvegarde projet, command palette.

## Décisions techniques (validées avec l'utilisateur)

1. **Direction = Atlas** (parmi Atlas / Workbench / Compass du design canvas).
2. **Fonds de carte** : OpenFreeMap (Liberty 3D / Bright / Positron, sans clé ;
   bâtiments 3D via `fill-extrusion`) **+ IGN Géoplateforme** (Plan IGN, Ortho IGN
   — raster, cible territoriale FR).
3. **Modèles 3D = custom layer three.js en InstancedMesh** (moteur inspiré
   d'EclExt) : MapLibre n'a pas de couche `model` native. Voir `Models3D`.
4. **MapLibre GL JS v5** (`maplibre-gl@5`) pour la **projection globe** (façon
   Google Earth, bascule auto en mercator au zoom). `applyProjection` /
   `STATE.settings.projection` ('globe' | 'mercator'), bascule dans le module Vue.
   Le custom layer 3D lit `args.defaultProjectionData.mainMatrix` (signature
   render v5) ; les modèles sont corrects en mercator (zoom utile), au globe
   très dézoomé ils peuvent être légèrement décalés (objets minuscules).

## Moteur 3D (`Models3D`) — repris/adapté d'EclExt

- **InstancedMesh** : 1 `InstancedMesh` par sous-maille de GLTF × groupe de
  modèle (au lieu d'un clone par objet) → des milliers d'objets tenables.
  Plafond `MAX_3D_INSTANCES = 20000`.
- **Origine de scène locale** (`setOrigin`/`localMeters`) : objets exprimés en
  mètres locaux, une seule matrice d'origine par frame (`_m4Origin`) → précision
  + matrices d'instances constantes.
- **Placement sur le relief** : `elevAt` (cache) interroge `queryTerrainElevation`
  par objet ; re-sync automatique quand les tuiles DEM arrivent (drift dans
  `render` → `recomputeAll`).
- **Fast-path d'édition** (`updateEdited`) : les sliders de l'inspecteur ne
  recalculent que les matrices des objets concernés (pas de rebuild/reload GLTF).
- **Culling viewport + gate de zoom** (`collect`, `cull` au `moveend`) :
  n'instancie que les objets dans l'emprise ; sous `MODEL3D_ZOOM_GATE` et au-delà
  de `MODEL3D_GATE_COUNT`, la 3D est masquée.
- Matériaux forcés en `DoubleSide` (la matrice d'origine a un Y négatif mercator
  → éviterait sinon le culling des faces avant des GLTF arbitraires).

## Relief & ambiance

- **Sources de relief** (`TERRAIN_SOURCES`) : terrarium mondial (sans clé) **ou
  LIDAR HD IGN** (France) décodé GeoTIFF Float32 → TerrainRGB via le protocole
  `ignmnt://` dans un **pool de Web Workers** (créé à la 1re utilisation).
- **Éclairage** : `computeAmbient` (jour/crépuscule/nuit) + `computeMoon`
  (éclairement lunaire SunCalc) pilotent `map.setLight`, le ciel `setSky` et les
  lumières three.js (`Models3D.setSun`).

## Conventions

- Pas de framework (vanilla JS + three.js). Handlers UI exposés via l'objet
  global `window.A` (les `onclick` inline appellent `A.xxx(...)`).
- Français pour l'UI et les commentaires.
- Tokens de couleur Atlas en variables CSS (`:root`).
- Persistance Grist optionnelle : table `Maquette_Layers` (Name, Color, Visible,
  GeomType, StyleJSON, GeoJSON). Le widget fonctionne aussi en **standalone**
  (sans Grist) avec autosave `localStorage` + export/import JSON.

## État actuel — fonctionne

- Carte MapLibre + OpenFreeMap, bâtiments 3D, terrain (DEM terrarium AWS, libre),
  ciel/atmosphère, éclairage solaire SunCalc (direction réaliste).
- Modules : **Lieu** (recherche Nominatim, géoloc, coords, rayon, nom de projet),
  **Couches** (liste, visibilité, suppression), **Symboliser** (couleur
  fixe/catégorisé/gradué, taille, modèle 3D, étiquette — aperçu live),
  **Modèles 3D** (bibliothèque GLTF), **Soleil** (presets, heure, date, ombres),
  **Vue & rendu** (pitch/bearing, fond, bâtiments/terrain/étiquettes/ciel).
- Import **OSM** (Overpass, presets) et **fichier GeoJSON** (drag & drop).
- **Sélection** d'objets sur la carte (clic, shift-clic, box-select), barre de
  sélection avec navigation prev/next, inspecteur d'édition (single + lot relatif).
- **Command palette** `⌘K`.
- Sauvegarde / chargement de projet JSON, export GeoJSON, autosave.

## Points d'attention / limites connues

- **Ombres portées** : MapLibre ne projette pas d'ombres au sol comme Mapbox
  Standard. Le toggle « Ombres » module l'éclairage des modèles three.js (pas de
  shadow map au sol). La direction de lumière suit bien la position solaire.
- **Perf 3D** : rendu en InstancedMesh (cf. section « Moteur 3D »), plafond
  `MAX_3D_INSTANCES = 20000`, culling viewport + gate de zoom.
- **Sémantique des rotations** des modèles : `rotationZ` = azimut (lacet, ordre
  d'Euler `YXZ`) — le contrôle principal. `rotationX`/`rotationY` (tangage/roulis)
  restent approximatifs.
- **MNT IGN** : `ignmnt://` requiert `OffscreenCanvas` (Chrome/Edge/Firefox,
  Safari ≥ 16.4) ; repli tuile plate si décodage échoue. Couverture France.
- **Modèles GLB** : catalogue procédural généré dans le repo par
  `scripts/generate-models.js` (`npm run models`) → `published/models/<set>/*.glb`
  (+ `catalog.json`). **37 modèles × 2 sets** (`colored` / `mono`), low-poly,
  modélisés en mètres (scale 1), base au sol. Servis via GitHub Pages :
  `MODEL_LIBRARY.baseRoot = https://nic01asfr.github.io/Widgets-Grist/models/`,
  set choisi dans le module Modèles (`A.setModelSet`). ⚠️ Les modèles n'apparaîtront
  qu'une fois `published/` déployé sur `gh-pages` (sinon repli cercle de hit).
  Pour ajouter un objet : éditer le `CATALOG` du générateur et relancer `npm run models`.
- **Interaction sur les modèles 3D** : les objets three.js ne sont pas
  interrogeables par `queryRenderedFeatures`. On ajoute donc une couche de
  cercles MapLibre (faible opacité) servant de zone de clic / surbrillance.
- **Tests** : non testé en navigateur réel dans l'environnement de dev (pas de
  navigateur headless). À ouvrir dans Grist ou un navigateur pour valider le
  rendu WebGL et le chargement des GLTF (`nic01asfr.github.io/3D-Models/`).

## Publication

Non publié. Pour publier : `published/atlas/` avec `package.json`
(section `grist`) + copie de `index.html`/`app.js`, puis `npm run manifest`.
`requiredAccess: 'full'` est requis (création de table `Maquette_Layers`).
