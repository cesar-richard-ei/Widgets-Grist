// ============================================================
// Atlas — Maquette 3D Territoriale (MapLibre + three.js)
// Refonte UX/UI "Atlas" du widget Grist (cf. design canvas).
// MapLibre GL JS remplace Mapbox ; les modèles 3D GLTF sont
// rendus via une custom layer three.js (MapLibre n'a pas de
// couche 'model' native).
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const deg2rad = (d) => (d * Math.PI) / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================
// CONFIG / STATE
// ============================================================
// Fonds : OpenFreeMap (vecteur, bâtiments 3D) + IGN Géoplateforme (raster FR)
const IGN = {
    plan:  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    ortho: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    // MNT LIDAR HD (GeoTIFF Float32) — décodé en TerrainRGB via le protocole ignmnt://
    mnt:   'ignmnt://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93&STYLES=&FORMAT=image/geotiff&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512',
};
function ignRasterStyle(tiles) {
    // Le fond IGN est une imagerie raster pure (Plan/Ortho) : on lui ajoute la
    // source vecteur OpenFreeMap + la couche de bâtiments 3D (fill-extrusion),
    // pour conserver le bâti et le même calage en Z que le style Liberty.
    return { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
            'ign': { type: 'raster', tiles: [tiles], tileSize: 256, attribution: '© IGN / Géoplateforme' },
            'openmaptiles': { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
        },
        layers: [
            { id: 'ign-base', type: 'raster', source: 'ign' },
            { id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
              paint: {
                  'fill-extrusion-base': ['get', 'render_min_height'],
                  'fill-extrusion-color': 'hsl(35,8%,85%)',
                  'fill-extrusion-height': ['get', 'render_height'],
                  'fill-extrusion-opacity': 0.8,
              } },
        ] };
}
const BASEMAPS = {
    liberty:  { url: 'https://tiles.openfreemap.org/styles/liberty',  label: 'Liberty 3D', icon: '✨' },
    bright:   { url: 'https://tiles.openfreemap.org/styles/bright',   label: 'Plan',       icon: '🗺️' },
    positron: { url: 'https://tiles.openfreemap.org/styles/positron', label: 'Clair',      icon: '⬜' },
    'plan-ign':  { style: () => ignRasterStyle(IGN.plan),  label: 'Plan IGN',  icon: '🇫🇷' },
    'ortho-ign': { style: () => ignRasterStyle(IGN.ortho), label: 'Ortho IGN', icon: '🛰️' },
};

// Sources de relief (DEM) : terrarium mondial (sans clé) ou LIDAR HD IGN (France)
const TERRAIN_SOURCES = {
    terrarium: { label: 'Mondial (terrarium)', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen / AWS' },
    ign:       { label: 'LIDAR HD IGN (FR)', tiles: [IGN.mnt], encoding: 'mapbox', tileSize: 512, maxzoom: 16, attribution: '© IGN LIDAR HD' },
};

const CONFIG = {
    defaultCenter: [1.4437, 43.6043], // Toulouse (Capitole)
    defaultZoom: 16,
    defaultPitch: 55,
    defaultBearing: -18,
    grist: { ready: false },
};

const STATE = {
    projectName: '',
    location: { name: 'Capitole · Toulouse', lat: 43.6043, lng: 1.4437, radius: 500 },
    layers: [],
    story: [],
    selectedLayer: null,
    currentModule: null,
    selection: { mode: false, layerId: null, features: [], multiIndex: 0 },
    settings: {
        basemap: 'liberty',
        projection: 'globe',     // 'globe' (façon Google Earth, → mercator en zoom) | 'mercator'
        modelSet: 'colored',     // jeu de modèles 3D : 'colored' | 'mono'
        buildings3D: true,
        terrain3D: false,
        terrainSource: 'terrarium',
        terrainExaggeration: 1.2,
        labels: true,
        sky: true,
        timeOfDay: 870,          // minutes (14:30)
        date: new Date(2026, 5, 15, 14, 30, 0),
        shadows: true,
    },
};

let map = null;
let dirty = false;

function markDirty() { dirty = true; $('app-header').classList.add('dirty'); }

// ============================================================
// PALETTES
// ============================================================
const COLOR_PALETTES = {
    Tableau10: ['#4e79a7','#f28e2c','#e15759','#76b7b2','#59a14f','#edc949','#af7aa1','#ff9da7','#9c755f','#bab0ab'],
    Set2: ['#66c2a5','#fc8d62','#8da0cb','#e78ac3','#a6d854','#ffd92f','#e5c494','#b3b3b3'],
    Verts: ['#E8F0D0','#B9D183','#7AB04A','#4A8331','#1E5219'],
    Bleus: ['#DEEBF7','#9ECAE1','#4292C6','#08519C','#08306B'],
    Oranges: ['#FFEDDA','#FDAE6B','#F16913','#A63603','#7F2704'],
    Viridis: ['#440154','#3e4a89','#26828e','#35b779','#6ece58','#b5de2b','#fde725'],
    YlOrRd: ['#ffffcc','#ffeda0','#fed976','#feb24c','#fc4e2a','#e31a1c','#800026'],
    RdYlGn: ['#d73027','#fdae61','#fee08b','#d9ef8b','#66bd63','#1a9850'],
};
const PALETTE_INFO = {
    Tableau10: { type: 'qualitative', name: 'Tableau 10' },
    Set2: { type: 'qualitative', name: 'Set 2' },
    Verts: { type: 'sequential', name: 'Verts' },
    Bleus: { type: 'sequential', name: 'Bleus' },
    Oranges: { type: 'sequential', name: 'Oranges' },
    Viridis: { type: 'sequential', name: 'Viridis' },
    YlOrRd: { type: 'sequential', name: 'Jaune-Rouge' },
    RdYlGn: { type: 'divergent', name: 'Rouge-Vert' },
};

// ============================================================
// BIBLIOTHÈQUE DE MODÈLES 3D
// ============================================================
// Catalogue 3D généré dans le repo (scripts/generate-models.js → published/atlas/models/)
// Servi via GitHub Pages. Deux sets de style : 'colored' | 'mono'. Modèles en mètres (scale 1).
// baseRoot résolu RELATIVEMENT au widget (import.meta.url) → portable (pas d'URL/dépôt en dur).
const MODEL_LIBRARY = {
    baseRoot: new URL('./models/', import.meta.url).href,
    set: 'colored',
    get baseUrl() { return this.baseRoot + this.set + '/'; },
    categories: {
        lighting: { icon: '💡', name: 'Éclairage', models: [
            { id: 'streetlamp', name: 'Lampadaire', icon: '🏮', file: 'Streetlamp.glb', scale: 1 },
            { id: 'streetlamp_double', name: 'Lampadaire double', icon: '🏮', file: 'StreetlampDouble.glb', scale: 1 },
            { id: 'lantern', name: 'Lanterne', icon: '🏮', file: 'Lantern.glb', scale: 1 },
            { id: 'lampball', name: 'Lampe boule', icon: '💡', file: 'Lampball.glb', scale: 1 },
            { id: 'wall_light', name: 'Applique', icon: '🔆', file: 'WallLight.glb', scale: 1 },
            { id: 'projector', name: 'Projecteur', icon: '🔦', file: 'Projector.glb', scale: 1 },
        ]},
        furniture: { icon: '🪑', name: 'Mobilier urbain', models: [
            { id: 'bench', name: 'Banc', icon: '🪑', file: 'Bench.glb', scale: 1 },
            { id: 'bench_simple', name: 'Banc simple', icon: '🪑', file: 'BenchSimple.glb', scale: 1 },
            { id: 'picnic_table', name: 'Table pique-nique', icon: '🪵', file: 'PicnicTable.glb', scale: 1 },
            { id: 'trashcan', name: 'Poubelle', icon: '🗑️', file: 'Trashcan.glb', scale: 1 },
            { id: 'bus_shelter', name: 'Abri bus', icon: '🚏', file: 'BusShelter.glb', scale: 1 },
            { id: 'bike_rack', name: 'Arceau vélo', icon: '🚲', file: 'BikeRack.glb', scale: 1 },
            { id: 'planter', name: 'Jardinière', icon: '🪴', file: 'Planter.glb', scale: 1 },
            { id: 'fountain', name: 'Fontaine', icon: '⛲', file: 'Fountain.glb', scale: 1 },
            { id: 'ev_charger', name: 'Borne recharge', icon: '⚡', file: 'EvCharger.glb', scale: 1 },
        ]},
        vegetation: { icon: '🌳', name: 'Végétation', models: [
            { id: 'tree_deciduous', name: 'Arbre feuillu', icon: '🌳', file: 'TreeDeciduous.glb', scale: 1 },
            { id: 'tree_conifer', name: 'Conifère', icon: '🌲', file: 'TreeConifer.glb', scale: 1 },
            { id: 'tree_palm', name: 'Palmier', icon: '🌴', file: 'TreePalm.glb', scale: 1 },
            { id: 'bush', name: 'Buisson', icon: '🌿', file: 'Bush.glb', scale: 1 },
            { id: 'hedge', name: 'Haie', icon: '🌳', file: 'Hedge.glb', scale: 1 },
            { id: 'flowerbed', name: 'Parterre fleuri', icon: '🌷', file: 'Flowerbed.glb', scale: 1 },
        ]},
        signalization: { icon: '🚦', name: 'Signalisation', models: [
            { id: 'traffic_light', name: 'Feu tricolore', icon: '🚦', file: 'TrafficLight.glb', scale: 1 },
            { id: 'stop_sign', name: 'Panneau stop', icon: '🛑', file: 'StopSign.glb', scale: 1 },
            { id: 'directional_sign', name: 'Panneau directionnel', icon: '🪧', file: 'DirectionalSign.glb', scale: 1 },
            { id: 'bollard', name: 'Potelet', icon: '🔶', file: 'Bollard.glb', scale: 1 },
            { id: 'barrier', name: 'Barrière', icon: '🚧', file: 'Barrier.glb', scale: 1 },
        ]},
        infrastructure: { icon: '🚧', name: 'Infrastructure', models: [
            { id: 'guardrail', name: 'Glissière', icon: '🚧', file: 'Guardrail.glb', scale: 1 },
            { id: 'stone_bollard', name: 'Borne béton', icon: '🪨', file: 'StoneBollard.glb', scale: 1 },
            { id: 'pole', name: 'Poteau', icon: '🔲', file: 'Pole.glb', scale: 1 },
            { id: 'fire_hydrant', name: 'Borne incendie', icon: '🧯', file: 'FireHydrant.glb', scale: 1 },
            { id: 'manhole', name: 'Regard', icon: '⚫', file: 'Manhole.glb', scale: 1 },
        ]},
        vehicles: { icon: '🚗', name: 'Véhicules', models: [
            { id: 'car', name: 'Voiture', icon: '🚗', file: 'Car.glb', scale: 1 },
            { id: 'van', name: 'Camionnette', icon: '🚐', file: 'Van.glb', scale: 1 },
            { id: 'bus', name: 'Bus', icon: '🚌', file: 'Bus.glb', scale: 1 },
            { id: 'bicycle', name: 'Vélo', icon: '🚲', file: 'Bicycle.glb', scale: 1 },
            { id: 'scooter', name: 'Trottinette', icon: '🛴', file: 'Scooter.glb', scale: 1 },
            { id: 'pedestrian', name: 'Piéton', icon: '🚶', file: 'Pedestrian.glb', scale: 1 },
        ]},
    },
};
// URL des modèles : override explicite (?models= / localStorage) sinon défaut
// GitHub Pages. probeLocalModels() (appelé à l'init) teste des chemins locaux et
// bascule dessus s'ils répondent — utile en dev avant déploiement gh-pages.
let MODEL_BASE_EXPLICIT = false;
(function () {
    try {
        const qp = new URLSearchParams(location.search).get('models');
        if (qp) { MODEL_LIBRARY.baseRoot = qp.replace(/\/+$/, '') + '/'; MODEL_BASE_EXPLICIT = true; return; }
        const ls = localStorage.getItem('atlas_model_base');
        if (ls) { MODEL_LIBRARY.baseRoot = ls.replace(/\/+$/, '') + '/'; MODEL_BASE_EXPLICIT = true; }
    } catch (e) {}
})();
async function probeLocalModels() {
    if (MODEL_BASE_EXPLICIT) return;
    // Sonde réservée au dev (serveur local) ; en prod l'URL relative est correcte.
    if (!/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname || location.host)) return;
    const cands = [];
    try {
        cands.push(new URL('./models/', location.href).href);                     // modèles à côté du widget
        cands.push(new URL('../../published/atlas/models/', location.href).href);  // racine du repo servie en dev
    } catch (e) { return; }
    for (const base of cands) {
        try {
            const r = await fetch(base + 'catalog.json', { cache: 'no-store' });
            if (r.ok && base !== MODEL_LIBRARY.baseRoot) {
                MODEL_LIBRARY.baseRoot = base;
                Models3D.gltfCache.clear(); Models3D.protoCache.clear(); Models3D.scheduleBuild();
                console.log('🧩 Atlas — modèles 3D servis localement :', base);
                return;
            }
        } catch (e) {}
    }
    console.log('🧩 Atlas — base modèles (défaut) :', MODEL_LIBRARY.baseUrl, '— aucun chemin local trouvé. Sers la racine du repo, ou règle la source dans le module Modèles.');
}
function allModels() {
    const out = [];
    for (const [catId, cat] of Object.entries(MODEL_LIBRARY.categories))
        for (const m of cat.models) out.push({ ...m, category: catId, url: MODEL_LIBRARY.baseUrl + m.file });
    return out;
}
function findModel(id) { return allModels().find((m) => m.id === id) || null; }

// ============================================================
// OSM PRESETS
// ============================================================
const OSM_PRESETS = {
    lighting:        { name: 'Éclairage', icon: '🏮', category: 'lighting', model: 'streetlamp', query: 'node["highway"="street_lamp"]' },
    trees:           { name: 'Arbres', icon: '🌳', category: 'vegetation', model: 'tree_deciduous', query: 'node["natural"="tree"]' },
    benches:         { name: 'Bancs', icon: '🪑', category: 'furniture', model: 'bench', query: 'node["amenity"="bench"]' },
    waste:           { name: 'Poubelles', icon: '🗑️', category: 'furniture', model: 'trashcan', query: 'node["amenity"="waste_basket"]' },
    traffic_signals: { name: 'Feux', icon: '🚦', category: 'signalization', model: 'traffic_light', query: 'node["highway"="traffic_signals"]' },
    bus_stops:       { name: 'Arrêts bus', icon: '🚏', category: 'furniture', model: 'bus_shelter', query: 'node["highway"="bus_stop"]' },
    bicycle_parking: { name: 'Vélos', icon: '🚲', category: 'furniture', model: 'bike_rack', query: 'node["amenity"="bicycle_parking"]' },
    bollards:        { name: 'Bornes', icon: '🔶', category: 'infrastructure', model: 'bollard', query: 'node["barrier"="bollard"]' },
    roads:           { name: 'Voirie', icon: '🛤️', geomType: 'LineString', query: 'way["highway"~"primary|secondary|tertiary|residential|unclassified"]' },
    buildings:       { name: 'Bâtiments', icon: '🏢', geomType: 'Polygon', query: 'way["building"]' },
};

// ============================================================
// SYMBOLISATION — helpers (expressions compatibles MapLibre)
// ============================================================
function getUniqueValues(layer, field, max = 100) {
    const counts = new Map();
    (layer.geojson?.features || []).forEach((f) => {
        let v = f.properties?.[field];
        if (v == null || v === '') return;
        const key = String(Array.isArray(v) ? v[0] : v);
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count).slice(0, max);
}
function getNumericRange(layer, field) {
    let min = Infinity, max = -Infinity, count = 0;
    (layer.geojson?.features || []).forEach((f) => {
        const v = parseFloat(f.properties?.[field]);
        if (!isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v); count++; }
    });
    if (!count) return { min: 0, max: 100, count: 0 };
    return { min, max, count };
}
// ============================================================
// CONTRÔLES — filtres/animation par champ (curseur temps/valeur, sélecteur)
// ============================================================
// type de contrôle pour un champ : 'time' | 'range' | 'select' | null
function controlField(layer, field) {
    const vals = [];
    for (const f of (layer.geojson?.features || [])) { const v = f.properties?.[field]; if (v != null && v !== '') vals.push(v); if (vals.length >= 50) break; }
    if (!vals.length) return null;
    const dateRe = /^\d{4}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/;
    if (vals.every((v) => typeof v === 'string' && dateRe.test(v.trim()) && !isNaN(Date.parse(v)))) return 'time';
    if (vals.every((v) => v !== true && v !== false && v !== '' && !isNaN(Number(v)))) return 'range';
    if (new Set(vals.map((v) => String(v))).size <= 20) return 'select';
    return null;
}
function controlBounds(layer, type, field) {
    if (type === 'select') return { values: getUniqueValues(layer, field, 40).map((v) => v.value) };
    let lo = Infinity, hi = -Infinity;
    for (const f of (layer.geojson?.features || [])) {
        const raw = f.properties?.[field]; if (raw == null || raw === '') continue;
        const n = type === 'time' ? Date.parse(raw) : Number(raw);
        if (!isNaN(n)) { lo = Math.min(lo, n); hi = Math.max(hi, n); }
    }
    if (lo === Infinity) return { dataMin: 0, dataMax: 1 };
    return { dataMin: lo, dataMax: hi };
}
function buildControlPredicate(layer) {
    const ctrls = (layer.controls || []).filter((c) => c.active);
    if (!ctrls.length) return null;
    return (f) => {
        const p = f.properties || {};
        for (const c of ctrls) {
            const raw = p[c.field];
            if (c.type === 'select') {
                if (c.values && !c.values.includes(String(raw))) return false;
            } else {
                if (raw == null || raw === '') continue;
                const n = c.type === 'time' ? Date.parse(raw) : Number(raw);
                if (isNaN(n)) continue;
                if (n < c.min || n > c.max) return false;
            }
        }
        return true;
    };
}
// Applique les contrôles : filtre la source 2D (setData) + prédicat pour la 3D.
function applyControls(layer) {
    layer._filterPredicate = buildControlPredicate(layer);
    const src = map && map.getSource(layer.id);
    if (src) src.setData(layer._filterPredicate ? { type: 'FeatureCollection', features: (layer.geojson.features || []).filter(layer._filterPredicate) } : layer.geojson);
    Models3D.scheduleBuild();
}

// ============================================================
// RÉCIT / STORYMAPS — séquence d'étapes (caméra + état) rejouables
// ============================================================
function captureStoryState() {
    return {
        camera: { center: map.getCenter().toArray(), zoom: +map.getZoom().toFixed(2), pitch: +map.getPitch().toFixed(1), bearing: +map.getBearing().toFixed(1) },
        projection: STATE.settings.projection,
        timeOfDay: STATE.settings.timeOfDay,
        date: STATE.settings.date.toISOString(),
        terrain3D: STATE.settings.terrain3D,
        layers: STATE.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible !== false, controls: (l.controls || []).filter((c) => c.active).map((c) => ({ field: c.field, type: c.type, min: c.min, max: c.max, values: c.values })) })),
    };
}
function applyStoryState(s) {
    if (!s || !map) return;
    (s.layers || []).forEach((ls) => {
        const l = STATE.layers.find((x) => x.id === ls.id) || STATE.layers.find((x) => x.name === ls.name);
        if (!l) return;
        setLayerVisibility(l, ls.visible);
        l.controls = l.controls || [];
        const stepFields = new Set((ls.controls || []).map((c) => c.field));
        (ls.controls || []).forEach((sc) => {
            let c = l.controls.find((x) => x.field === sc.field);
            if (!c) { c = { field: sc.field, type: sc.type }; Object.assign(c, controlBounds(l, sc.type, sc.field)); l.controls.push(c); }
            c.active = true; if (sc.min != null) c.min = sc.min; if (sc.max != null) c.max = sc.max; if (sc.values) c.values = sc.values;
        });
        l.controls.forEach((c) => { if (!stepFields.has(c.field)) c.active = false; });
        applyControls(l);
    });
    if (s.projection && s.projection !== STATE.settings.projection) { STATE.settings.projection = s.projection; applyProjection(); }
    if (s.terrain3D != null && s.terrain3D !== STATE.settings.terrain3D) { STATE.settings.terrain3D = s.terrain3D; applyTerrain(); setTimeout(() => Models3D.recomputeAll(), 250); }
    if (s.timeOfDay != null) STATE.settings.timeOfDay = s.timeOfDay;
    if (s.date) STATE.settings.date = new Date(s.date);
    updateLighting();
    if (s.camera) map.flyTo({ center: s.camera.center, zoom: s.camera.zoom, pitch: s.camera.pitch, bearing: s.camera.bearing, duration: 1500 });
}
const STORY_SCHEMA = [
    { id: 'Step', fields: { label: 'Étape', type: 'Int' } },
    { id: 'Title', fields: { label: 'Titre', type: 'Text' } },
    { id: 'Description', fields: { label: 'Texte', type: 'Text' } },
    { id: 'StateJSON', fields: { label: 'État (JSON)', type: 'Text' } },
];
async function saveStoryToGrist() {
    if (!CONFIG.grist.ready) return;
    try {
        const tables = await grist.docApi.listTables();
        if (!tables.includes('Atlas_Story')) await grist.docApi.applyUserActions([['AddTable', 'Atlas_Story', STORY_SCHEMA]]);
        const rec = await grist.docApi.fetchTable('Atlas_Story');
        if (rec.id && rec.id.length) await grist.docApi.applyUserActions([['BulkRemoveRecord', 'Atlas_Story', rec.id]]);
        if (STATE.story.length) await grist.docApi.applyUserActions([['BulkAddRecord', 'Atlas_Story', STATE.story.map(() => null), {
            Step: STATE.story.map((_, i) => i + 1),
            Title: STATE.story.map((s) => s.title || ''),
            Description: STATE.story.map((s) => s.text || ''),
            StateJSON: STATE.story.map((s) => JSON.stringify(s.state || {})),
        }]]);
    } catch (e) { console.warn('story save', e.message); }
}
async function loadStoryFromGrist() {
    if (!CONFIG.grist.ready) return;
    try {
        const tables = await grist.docApi.listTables();
        if (!tables.includes('Atlas_Story')) return;
        const rec = await grist.docApi.fetchTable('Atlas_Story'); const n = (rec.id || []).length; const rows = [];
        for (let i = 0; i < n; i++) rows.push({ step: rec.Step?.[i] ?? i + 1, title: rec.Title?.[i] || '', text: rec.Description?.[i] || '', state: (() => { try { return JSON.parse(rec.StateJSON[i]); } catch (e) { return {}; } })() });
        rows.sort((a, b) => a.step - b.step);
        STATE.story = rows.map((r) => ({ title: r.title, text: r.text, state: r.state }));
    } catch (e) { console.warn('story load', e.message); }
}

function detectFieldType(layer, field) {
    let num = 0, total = 0;
    (layer.geojson?.features || []).slice(0, 200).forEach((f) => {
        const v = f.properties?.[field];
        if (v == null) return; total++;
        if (!isNaN(parseFloat(v)) && isFinite(v)) num++;
    });
    if (!total) return 'text';
    return num / total > 0.7 ? 'numeric' : 'text';
}
function getLayerFields(layer) {
    const keys = new Set();
    (layer.geojson?.features || []).slice(0, 200).forEach((f) => {
        if (f.properties) Object.keys(f.properties).forEach((k) => { if (!k.startsWith('_')) keys.add(k); });
    });
    return Array.from(keys).sort().map((k) => ({ id: k, type: detectFieldType(layer, k) }));
}
function paletteColor(name, i, total) {
    const p = COLOR_PALETTES[name] || COLOR_PALETTES.Tableau10;
    if (PALETTE_INFO[name]?.type === 'qualitative') return p[i % p.length];
    // sequential/divergent: spread across palette
    const idx = total <= 1 ? 0 : Math.round((i / (total - 1)) * (p.length - 1));
    return p[clamp(idx, 0, p.length - 1)];
}
function fieldExpr(field) {
    return ['coalesce', ['at', 0, ['get', field]], ['get', field]];
}
function buildColorMatch(field, categories, def) {
    const expr = ['match', fieldExpr(field)];
    const seen = new Set();
    categories.forEach((c) => { const k = String(c.value); if (!seen.has(k)) { seen.add(k); expr.push(k, c.color); } });
    expr.push(def || '#999999');
    return expr;
}
function transformedValueExpr(field, method) {
    if (method === 'log') return ['ln', ['+', ['to-number', ['get', field]], 1]];
    if (method === 'sqrt') return ['sqrt', ['to-number', ['get', field]]];
    return ['to-number', ['get', field]];
}
function transformedBounds(range, method) {
    if (method === 'log') return [Math.log(range[0] + 1), Math.log(range[1] + 1)];
    if (method === 'sqrt') return [Math.sqrt(range[0]), Math.sqrt(range[1])];
    return [range[0], range[1]];
}
function buildColorGraduated(field, range, palette, method) {
    const p = COLOR_PALETTES[palette] || COLOR_PALETTES.Viridis;
    const [inMin, inMax] = transformedBounds(range, method);
    const expr = ['interpolate', ['linear'], transformedValueExpr(field, method)];
    const step = (inMax - inMin) / (p.length - 1) || 1;
    p.forEach((c, i) => expr.push(inMin + step * i, c));
    return expr;
}
function buildNumGraduated(field, range, outRange, method) {
    const [inMin, inMax] = transformedBounds(range, method);
    return ['interpolate', ['linear'], transformedValueExpr(field, method), inMin, outRange[0], inMax, outRange[1]];
}
function interpolateValue(value, range, outRange, method) {
    let v = parseFloat(value); if (isNaN(v)) return outRange[0];
    let [inMin, inMax] = transformedBounds(range, method);
    if (method === 'log') v = Math.log(v + 1); else if (method === 'sqrt') v = Math.sqrt(v);
    const r = clamp((v - inMin) / ((inMax - inMin) || 1), 0, 1);
    return outRange[0] + r * (outRange[1] - outRange[0]);
}

function initSymbolization(layer) {
    if (!layer.style) layer.style = {};
    if (!layer.style.symbolization) {
        layer.style.symbolization = {
            color: { mode: 'single', field: null, value: layer.color, palette: 'Tableau10', colorRamp: 'Viridis', categories: [], defaultColor: '#999999', method: 'linear' },
            size: { mode: 'single', field: null, value: layer.geometryType === 'Point' ? 8 : (layer.geometryType === 'Polygon' ? 12 : 4), outputRange: [4, 24], method: 'linear' },
            model: { mode: 'single', field: null, categories: [], defaultModelId: null },
            orientation: { field: null }, // azimut (rotation Z) lié à un champ (B)
            label: { enabled: false, field: null },
        };
    }
    return layer.style.symbolization;
}

// ============================================================
// AMBIANCE — soleil + lune (jour/crépuscule/nuit), inspiré EclExt
// ============================================================
function _lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }
function _lerpHex(c1, c2, t) {
    t = clamp(t, 0, 1);
    return '#' + [0, 1, 2].map((i) => Math.round(c1[i] + (c2[i] - c1[i]) * t).toString(16).padStart(2, '0')).join('');
}
function computeMoon(date, lat, lng) {
    if (typeof SunCalc === 'undefined') return null;
    try {
        const pos = SunCalc.getMoonPosition(date, lat, lng);
        const illum = SunCalc.getMoonIllumination(date);
        const altDeg = pos.altitude * 180 / Math.PI;
        const azDeg = ((pos.azimuth * 180 / Math.PI) + 180) % 360;
        let altFactor = altDeg > 0 ? Math.sin(altDeg * Math.PI / 180) * (altDeg < 20 ? altDeg / 20 : 1) : 0;
        const distFactor = Math.pow(384400 / (pos.distance || 384400), 2);
        const moonIntensity = Math.min(1, illum.fraction * altFactor * distFactor / 0.4);
        return { altDeg, azDeg, fraction: illum.fraction, phase: illum.phase, isUp: altDeg > 0, moonIntensity };
    } catch (e) { return null; }
}
// Renvoie les paramètres d'ambiance pour une altitude solaire donnée
function computeAmbient(altDeg, moon) {
    const DAY = [255, 255, 255], GOLD = [255, 210, 140], TWIL = [120, 110, 150], NIGHT = [16, 22, 52];
    let sunColor, sunIntensity, ambientColor, ambientIntensity, mapColor, mapIntensity, sky, horizon;
    if (altDeg > 8) { sunColor = '#ffffff'; sunIntensity = 2.0; ambientColor = '#f3ecd9'; ambientIntensity = 1.0; mapColor = '#ffffff'; mapIntensity = 0.55; sky = '#aacbe8'; horizon = '#f3ecd9'; }
    else if (altDeg > 0) { const t = altDeg / 8; sunColor = _lerpHex(GOLD, DAY, t); sunIntensity = _lerp(1.2, 2.0, t); ambientColor = _lerpHex(GOLD, [243, 236, 217], t); ambientIntensity = _lerp(0.8, 1.0, t); mapColor = _lerpHex(GOLD, DAY, t); mapIntensity = _lerp(0.4, 0.55, t); sky = _lerpHex([230, 150, 90], [170, 203, 232], t); horizon = '#f0c89a'; }
    else if (altDeg > -6) { const t = (altDeg + 6) / 6; sunColor = _lerpHex(TWIL, GOLD, t); sunIntensity = _lerp(0.4, 1.2, t); ambientColor = _lerpHex([60, 60, 95], GOLD, t); ambientIntensity = _lerp(0.45, 0.8, t); mapColor = _lerpHex([90, 90, 130], GOLD, t); mapIntensity = _lerp(0.3, 0.4, t); sky = _lerpHex([60, 55, 90], [230, 150, 90], t); horizon = _lerpHex([70, 60, 95], [240, 200, 154], t); }
    else { const t = clamp((altDeg + 18) / 12, 0, 1); sunColor = '#1a2030'; sunIntensity = _lerp(0.06, 0.4, t); ambientColor = _lerpHex(NIGHT, [60, 60, 95], t); ambientIntensity = _lerp(0.22, 0.45, t); mapColor = _lerpHex([20, 28, 60], [90, 90, 130], t); mapIntensity = _lerp(0.16, 0.3, t); sky = _lerpHex([8, 11, 28], [60, 55, 90], t); horizon = _lerpHex([14, 18, 42], [70, 60, 95], t); }
    let hemiIntensity = clamp(0.2 + (altDeg + 6) / 40, 0.12, 0.55);
    // Apport lunaire la nuit
    if (moon && altDeg < -2 && moon.isUp && moon.moonIntensity > 0.05) {
        const mi = moon.moonIntensity;
        ambientIntensity += mi * 0.22; mapIntensity += mi * 0.12; hemiIntensity += mi * 0.15;
        ambientColor = _lerpHex([parseInt(ambientColor.slice(1, 3), 16), parseInt(ambientColor.slice(3, 5), 16), parseInt(ambientColor.slice(5, 7), 16)], [120, 140, 190], Math.min(0.5, mi * 0.5));
    }
    return { sunColor, sunIntensity, ambientColor, ambientIntensity, hemiIntensity, mapColor, mapIntensity, sky, horizon };
}

// ============================================================
// PROTOCOLE ignmnt:// — décodage MNT IGN (GeoTIFF Float32 → TerrainRGB)
// dans un pool de Web Workers (hors thread principal). Pool créé à la
// première utilisation (évite le coût si le relief IGN n'est pas activé).
// ============================================================
let _ignDemPool = null;
function ignDemPool() {
    if (_ignDemPool) return _ignDemPool;
    const src = `
        self.importScripts('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js');
        self.onmessage = async (e) => {
            const { id, buffer } = e.data;
            try {
                const tiff = await GeoTIFF.fromArrayBuffer(buffer);
                const image = await tiff.getImage();
                const rasters = await image.readRasters();
                const w = image.getWidth(), h = image.getHeight(), elev = rasters[0];
                const rgba = new Uint8ClampedArray(w*h*4);
                for (let i=0;i<elev.length;i++){ let v=elev[i]; if(!isFinite(v)||v<-500||v>9000)v=0; const enc=Math.round((v+10000)/0.1); rgba[i*4]=(enc>>16)&255; rgba[i*4+1]=(enc>>8)&255; rgba[i*4+2]=enc&255; rgba[i*4+3]=255; }
                const c = new OffscreenCanvas(w,h); c.getContext('2d').putImageData(new ImageData(rgba,w,h),0,0);
                const b = await c.convertToBlob({type:'image/png'}); const out = new Uint8Array(await b.arrayBuffer());
                self.postMessage({ id, ok:true, data: out }, [out.buffer]);
            } catch(err) { self.postMessage({ id, ok:false, error: String(err && err.message || err) }); }
        };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    const N = Math.min(3, navigator.hardwareConcurrency || 2);
    const workers = []; const pending = new Map(); let seq = 0, rr = 0;
    for (let i = 0; i < N; i++) {
        const w = new Worker(url);
        w.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data.data) : p.reject(new Error(e.data.error)); };
        workers.push(w);
    }
    _ignDemPool = { decode(buf) { return new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); workers[rr++ % N].postMessage({ id, buffer: buf }, [buf]); }); } };
    return _ignDemPool;
}
let _flatDem = null;
async function flatDemTile() {
    if (_flatDem) return _flatDem;
    const size = 256, rgba = new Uint8ClampedArray(size * size * 4), e0 = Math.round(10000 / 0.1);
    for (let i = 0; i < size * size; i++) { rgba[i * 4] = (e0 >> 16) & 255; rgba[i * 4 + 1] = (e0 >> 8) & 255; rgba[i * 4 + 2] = e0 & 255; rgba[i * 4 + 3] = 255; }
    const c = new OffscreenCanvas(size, size); c.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0);
    _flatDem = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return _flatDem;
}
(function registerIGNTerrain() {
    if (typeof maplibregl === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
    maplibregl.addProtocol('ignmnt', async (params, abort) => {
        const url = 'https://' + params.url.replace('ignmnt://', '');
        try {
            const r = await fetch(url, { signal: abort.signal, headers: { 'Accept': 'image/tiff, image/geotiff' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const buf = await r.arrayBuffer();
            const hd = new Uint8Array(buf, 0, 4);
            const isTiff = (hd[0] === 0x49 && hd[1] === 0x49) || (hd[0] === 0x4D && hd[1] === 0x4D);
            if (!isTiff || buf.byteLength < 100) throw new Error('not tiff');
            return { data: await ignDemPool().decode(buf) };
        } catch (e) { if (abort.signal.aborted) throw e; return { data: await flatDemTile() }; }
    });
})();

// ============================================================
// MODÈLES 3D — custom layer three.js, rendu InstancedMesh
// (moteur inspiré d'EclExt : origine locale, instancing, fast-path
//  d'édition, culling viewport, placement sur le relief)
// ============================================================
const MAX_3D_INSTANCES = 20000;       // plafond élevé grâce à l'instancing
const MODEL3D_ZOOM_GATE = 11;          // sous ce zoom on cache la 3D si beaucoup d'objets
const MODEL3D_GATE_COUNT = 4000;
const SHADOW_FEATURE_CAP = 1500;       // ombres portées réelles seulement sous ce nombre d'objets visibles

const Models3D = {
    layerId: 'three-models-3d',
    scene: null, camera: null, renderer: null,
    gltfCache: new Map(),   // url -> Promise<THREE.Group|null>
    protoCache: new Map(),  // url -> [{geometry, material, mat}] | null
    groups: new Map(),      // url -> { meshes:[{im, protoMat}], items:[{layerId, idx, lng, lat}] }
    slotIndex: new Map(),   // `${layerId}:${idx}` -> { url, slot }
    origin: null, originMC: null, originScale: 1, originElev: 0,
    elevCache: new Map(),
    sunDir: new THREE.Vector3(0.4, 0.7, 0.4).normalize(),
    dirLight: null, ambLight: null, hemiLight: null, groundShadow: null, _shadowFeasible: false,
    _buildTimer: null, _cullTimer: null, _driftTimer: null, _lastOriginElev: undefined,
    _m4Origin: new THREE.Matrix4(), _m4VP: new THREE.Matrix4(),
    _mRotX: new THREE.Matrix4().makeRotationX(Math.PI / 2),
    _vScale: new THREE.Vector3(), _obj: new THREE.Object3D(), _m4: new THREE.Matrix4(),

    scheduleBuild() { clearTimeout(this._buildTimer); this._buildTimer = setTimeout(() => this.build(), 60); },
    forceBuild() { clearTimeout(this._buildTimer); this._buildTimer = null; this.build(); }, // rebuild immédiat (changement de modèle)
    // alias rétro-compat (anciens appels)
    rebuildScene() { this.build(); },
    scheduleRebuild() { this.scheduleBuild(); },

    makeLayer() {
        const self = this;
        return {
            id: self.layerId, type: 'custom', renderingMode: '3d',
            onAdd(m, gl) {
                self.camera = new THREE.Camera();
                self.scene = new THREE.Scene();
                self.ambLight = new THREE.AmbientLight(0xffffff, 1.0);
                self.dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
                self.dirLight.position.copy(self.sunDir).multiplyScalar(100);
                self.hemiLight = new THREE.HemisphereLight(0xbcd4e8, 0x55492f, 0.45);
                self.scene.add(self.ambLight, self.dirLight, self.hemiLight);
                self.renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
                self.renderer.autoClear = false;
                // Ombres portées (shadow maps) — actives seulement hors terrain 3D
                // (avec terrain MapLibre rend dans un FBO offscreen incompatible).
                try {
                    self.renderer.shadowMap.enabled = true;
                    self.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
                    self.dirLight.castShadow = true;
                    const sh = self.dirLight.shadow;
                    sh.mapSize.set(2048, 2048);
                    sh.camera.near = 1; sh.camera.far = 1400;
                    sh.camera.left = -260; sh.camera.right = 260; sh.camera.top = 260; sh.camera.bottom = -260;
                    sh.bias = -0.0005; sh.normalBias = 0.6;
                    self.scene.add(self.dirLight.target);
                    const g = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.ShadowMaterial({ opacity: 0.34 }));
                    g.rotation.x = -Math.PI / 2; g.position.y = 0.02; g.receiveShadow = true; g.frustumCulled = false;
                    self.groundShadow = g; self.scene.add(g);
                } catch (e) { console.warn('shadow setup', e.message); }
                self.build();
            },
            render(gl, matrix) {
                if (!self.renderer || !self.origin) return;
                const arr = Array.isArray(matrix) ? matrix : (matrix && (matrix.defaultProjectionData?.mainMatrix || matrix.mainMatrix));
                if (!arr) return;
                // élévation de l'origine — peut évoluer pendant le chargement des tuiles DEM
                const elev = STATE.settings.terrain3D ? (map.queryTerrainElevation(self.origin) || 0) : 0;
                if (self._lastOriginElev !== undefined && Math.abs(elev - self._lastOriginElev) > 0.5) {
                    clearTimeout(self._driftTimer);
                    self._driftTimer = setTimeout(() => self.recomputeAll(), 200);
                }
                self._lastOriginElev = elev;
                const mc = maplibregl.MercatorCoordinate.fromLngLat(self.origin, elev);
                const s = mc.meterInMercatorCoordinateUnits();
                self._vScale.set(s, -s, s);
                self._m4Origin.makeTranslation(mc.x, mc.y, mc.z).scale(self._vScale).multiply(self._mRotX);
                // Ombres : seulement hors terrain, sous le plafond d'objets, et zoomé.
                const wantShadow = STATE.settings.shadows && !STATE.settings.terrain3D && self._shadowFeasible && self.sunDir.y > 0.05 && map.getZoom() >= 14;
                if (self.renderer.shadowMap.enabled !== wantShadow) self.renderer.shadowMap.enabled = wantShadow;
                self.dirLight.castShadow = wantShadow;
                if (self.groundShadow) self.groundShadow.visible = wantShadow;
                if (wantShadow) {
                    // centrer la lumière/ombre sur le centre de vue (mètres locaux)
                    const c = map.getCenter(), lm = self.localMeters(c.lng, c.lat);
                    const cx = lm.x, cz = -lm.y;
                    self.dirLight.target.position.set(cx, 0, cz);
                    self.dirLight.position.set(cx + self.sunDir.x * 300, self.sunDir.y * 300, cz + self.sunDir.z * 300);
                    self.dirLight.target.updateMatrixWorld();
                } else {
                    self.dirLight.position.copy(self.sunDir).multiplyScalar(300);
                }
                self._m4VP.fromArray(arr).multiply(self._m4Origin);
                self.camera.projectionMatrix.copy(self._m4VP);
                self.renderer.resetState();
                // Resynchronise le viewport sur le canvas courant : sinon, quand
                // MapLibre redimensionne le canvas (iframe Grist), three.js garde
                // l'ancien viewport et les objets « glissent » par rapport à la carte.
                const cv = map.getCanvas();
                self.renderer.setViewport(0, 0, cv.width, cv.height);
                self.renderer.render(self.scene, self.camera);
            },
            onRemove() { self.disposeInstances(); self.renderer?.dispose?.(); self.renderer = null; self.scene = null; },
        };
    },

    async ensureGLTF(url) {
        if (!this.gltfCache.has(url)) {
            const loader = new GLTFLoader();
            this.gltfCache.set(url, loader.loadAsync(url).then((g) => g.scene).catch((e) => { console.warn('GLTF load failed', url, e.message); return null; }));
        }
        return this.gltfCache.get(url);
    },
    // prototypes = liste de sous-mailles {geometry, material, mat(local)} pour l'instancing
    async ensureProto(url) {
        if (this.protoCache.has(url)) return this.protoCache.get(url);
        const scene = await this.ensureGLTF(url);
        if (!scene) { this.protoCache.set(url, null); return null; }
        scene.updateMatrixWorld(true);
        const parts = [];
        // La matrice d'origine par frame contient une mise à l'échelle Y négative
        // (mercator) → on force DoubleSide pour éviter le culling des faces avant.
        const fix = (m) => { const c = m.clone(); c.side = THREE.DoubleSide; return c; };
        scene.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            const material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
            parts.push({ geometry: o.geometry, material, mat: o.matrixWorld.clone() });
        });
        const v = parts.length ? parts : null;
        this.protoCache.set(url, v); return v;
    },

    setOrigin(lng, lat) { this.origin = [lng, lat]; this.originMC = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0); this.originScale = this.originMC.meterInMercatorCoordinateUnits(); },
    localMeters(lng, lat) { const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0), s = this.originScale; return { x: (mc.x - this.originMC.x) / s, y: -(mc.y - this.originMC.y) / s }; },
    elevAt(lng, lat) {
        if (!STATE.settings.terrain3D || !map) return 0;
        const k = ((lng * 1e4) | 0) + ',' + ((lat * 1e4) | 0);
        if (this.elevCache.has(k)) return this.elevCache.get(k);
        const v = map.queryTerrainElevation([lng, lat]) || 0;
        if (this.elevCache.size > 8000) this.elevCache.clear();
        this.elevCache.set(k, v); return v;
    },

    // matrice de placement (espace local mètres, Y up) pour une feature
    placement(layer, feature) {
        const p = resolveFeatureProps(feature, layer);
        const [lng, lat] = feature.geometry.coordinates;
        const lm = this.localMeters(lng, lat);
        const eOff = this.elevAt(lng, lat) - this.originElev;
        const o = this._obj;
        o.position.set(lm.x + (p.offsetX || 0), eOff + (p.offsetZ || 0), -lm.y - (p.offsetY || 0));
        const sc = p.scale || 1; o.scale.set(sc, sc, sc);
        o.rotation.set(deg2rad(p.rotationX || 0), deg2rad(p.rotationZ || 0), deg2rad(p.rotationY || 0), 'YXZ');
        o.updateMatrix();
        return o.matrix;
    },

    // collecte des features 3D dans l'emprise (culling viewport)
    collect() {
        const out = [];
        if (!map) return out;
        const b = map.getBounds(), buf = 0.004;
        for (const layer of STATE.layers) {
            if (layer.visible === false) continue;
            if (layer.geometryType !== 'Point' && layer.geometryType !== 'MultiPoint') continue;
            if (layer.style?.mode !== 'library' && layer.style?.mode !== 'custom') continue;
            const defUrl = getLayerModelUrl(layer);
            const sym = layer.style.symbolization || {};
            const categorized = sym.model?.mode === 'categorized' && sym.model.field;
            const feats = layer.geojson?.features || [];
            // modèle par objet via colonne/override (convention) : on collecte aussi
            const perFeatureModel = feats.some((f) => f.properties && (f.properties._modelId || f.properties.model_id || f.properties.model_glb));
            if (!defUrl && !categorized && !perFeatureModel) continue;
            for (let idx = 0; idx < feats.length; idx++) {
                const f = feats[idx];
                if (f.geometry?.type !== 'Point') continue;
                if (layer._filterPredicate && !layer._filterPredicate(f)) continue; // contrôles/filtres
                const [lng, lat] = f.geometry.coordinates;
                if (lng < b.getWest() - buf || lng > b.getEast() + buf || lat < b.getSouth() - buf || lat > b.getNorth() + buf) continue;
                let url = defUrl;
                const attId = featureAttachmentId(f);
                if (attId != null) { url = attachmentUrlSync(attId); } // modèle en pièce jointe (prioritaire)
                else if (categorized || f.properties?._modelId || f.properties?.model_id) { const mm = findModel(resolveFeatureProps(f, layer).modelId); if (mm) url = mm.url; }
                if (!url) continue;
                out.push({ layerId: layer.id, idx, lng, lat, url });
                if (out.length >= MAX_3D_INSTANCES) return out;
            }
        }
        return out;
    },

    async build() {
        if (!this.scene || !map) return;
        const token = (this._buildToken = (this._buildToken || 0) + 1);
        this.disposeInstances();
        const all = this.collect();
        const z = map.getZoom();
        this._shadowFeasible = all.length > 0 && all.length <= SHADOW_FEATURE_CAP; // ombres réelles seulement sous ce plafond
        if ((z < MODEL3D_ZOOM_GATE && all.length > MODEL3D_GATE_COUNT) || all.length === 0) { map.triggerRepaint(); return; }
        if (!this.origin) this.setOrigin(all[0].lng, all[0].lat);
        this.originElev = STATE.settings.terrain3D ? (map.queryTerrainElevation(this.origin) || 0) : 0;

        const byUrl = new Map();
        for (const it of all) { if (!byUrl.has(it.url)) byUrl.set(it.url, []); byUrl.get(it.url).push(it); }
        const urls = [...byUrl.keys()];
        const protos = await Promise.all(urls.map((u) => this.ensureProto(u)));
        if (!this.scene || token !== this._buildToken) return; // superseded / style changé

        this.slotIndex.clear();
        urls.forEach((url, ui) => {
            const proto = protos[ui]; const items = byUrl.get(url);
            if (!proto) return;
            const meshes = proto.map((part) => {
                const im = new THREE.InstancedMesh(part.geometry, part.material, items.length);
                im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
                return { im, protoMat: part.mat };
            });
            items.forEach((it, slot) => {
                const layer = STATE.layers.find((l) => l.id === it.layerId);
                const feature = layer?.geojson?.features?.[it.idx];
                if (!feature) return;
                const place = this.placement(layer, feature);
                meshes.forEach(({ im, protoMat }) => { this._m4.multiplyMatrices(place, protoMat); im.setMatrixAt(slot, this._m4); });
                this.slotIndex.set(it.layerId + ':' + it.idx, { url, slot });
            });
            meshes.forEach(({ im }) => { im.instanceMatrix.needsUpdate = true; this.scene.add(im); });
            this.groups.set(url, { meshes, items });
        });
        map.triggerRepaint();
    },

    // recompute TOUTES les matrices (sans regrouper) — relief chargé / exagération
    recomputeAll() {
        if (!this.origin || !map || !this.scene) return;
        this.elevCache.clear();
        this.originElev = STATE.settings.terrain3D ? (map.queryTerrainElevation(this.origin) || 0) : 0;
        for (const [, g] of this.groups) {
            g.items.forEach((it, slot) => {
                const layer = STATE.layers.find((l) => l.id === it.layerId);
                const feature = layer?.geojson?.features?.[it.idx];
                if (!feature) return;
                const place = this.placement(layer, feature);
                g.meshes.forEach(({ im, protoMat }) => { this._m4.multiplyMatrices(place, protoMat); im.setMatrixAt(slot, this._m4); });
            });
            g.meshes.forEach(({ im }) => { im.instanceMatrix.needsUpdate = true; });
        }
        map.triggerRepaint();
    },

    // FAST PATH — met à jour les matrices des features éditées sans rebuild
    updateEdited(layerId, indices) {
        if (!this.origin || !this.scene) { this.scheduleBuild(); return; }
        const layer = STATE.layers.find((l) => l.id === layerId); if (!layer) return;
        let touched = false, missing = false;
        for (const idx of indices) {
            const ref = this.slotIndex.get(layerId + ':' + idx);
            if (!ref) { missing = true; continue; } // hors emprise / non instancié
            const g = this.groups.get(ref.url); if (!g) continue;
            const feature = layer.geojson.features[idx]; if (!feature) continue;
            const place = this.placement(layer, feature);
            g.meshes.forEach(({ im, protoMat }) => { this._m4.multiplyMatrices(place, protoMat); im.setMatrixAt(ref.slot, this._m4); im.instanceMatrix.needsUpdate = true; });
            touched = true;
        }
        if (touched) map.triggerRepaint();
        if (missing) this.scheduleBuild();
    },

    cull() { clearTimeout(this._cullTimer); this._cullTimer = setTimeout(() => this.build(), 200); },

    disposeInstances() {
        if (!this.scene) { this.groups.clear(); this.slotIndex.clear(); return; }
        for (const [, g] of this.groups) g.meshes.forEach(({ im }) => { this.scene.remove(im); im.dispose?.(); });
        this.groups.clear(); this.slotIndex.clear();
    },

    setSun(azimuthDeg, altitudeDeg, moon) {
        const az = deg2rad(azimuthDeg), al = deg2rad(Math.max(-0.1, altitudeDeg));
        // espace scène local : X=est, Y=haut, Z=-nord
        this.sunDir.set(Math.sin(az) * Math.cos(al), Math.sin(al), -Math.cos(az) * Math.cos(al)).normalize();
        if (!this.dirLight) return;
        const amb = computeAmbient(altitudeDeg, moon);
        this.dirLight.color.set(amb.sunColor); this.dirLight.intensity = amb.sunIntensity * (STATE.settings.shadows ? 1.0 : 0.7);
        this.ambLight.color.set(amb.ambientColor); this.ambLight.intensity = amb.ambientIntensity;
        if (this.hemiLight) this.hemiLight.intensity = amb.hemiIntensity;
        map && map.triggerRepaint();
    },
};
function getLayerModelUrl(layer) {
    const s = layer.style;
    if (!s) return null;
    if (s.mode === 'custom' && s.custom?.url) return s.custom.url;
    if (s.mode === 'library' && s.library?.modelId) { const m = findModel(s.library.modelId); return m?.url || null; }
    return null;
}
function resolveFeatureProps(feature, layer) {
    const p = feature.properties || {};
    const c = layer.style?.common || {};
    const sym = layer.style?.symbolization || {};
    const num = (vals, d) => { for (const v of vals) { if (v != null && v !== '') { const n = Number(v); if (!isNaN(n)) return n; } } return d; };

    let symScale = null;
    if (sym.size?.mode === 'graduated' && sym.size.field && (layer.style?.mode === 'library' || layer.style?.mode === 'custom')) {
        const r = getNumericRange(layer, sym.size.field);
        symScale = interpolateValue(p[sym.size.field], [r.min, r.max], sym.size.outputRange || [0.5, 3], sym.size.method);
    }
    // modèle : override objet (_modelId / colonne model_id) > catégorisé > défaut couche
    let modelId = p._modelId ?? p.model_id ?? null;
    if (!modelId && sym.model?.mode === 'categorized' && sym.model.field) {
        const cat = sym.model.categories?.find((c2) => String(c2.value) === String(p[sym.model.field]));
        modelId = cat?.modelId ?? sym.model.defaultModelId ?? null;
    }
    if (!modelId) modelId = layer.style?.library?.modelId ?? null;
    const m = modelId ? findModel(modelId) : null; // défaut du modèle (C)
    // azimut lié à un champ (B) : liaison entre override objet et défaut couche
    const fieldRotZ = sym.orientation?.field ? p[sym.orientation.field] : null;

    // Précédence (convention §2bis) : override objet (_x / colonne) > liaison champ
    // > défaut couche (style.common) > défaut modèle.
    return {
        scale:     num([p._scale, p.scale, symScale, c.scale, m?.scale], 1),
        rotationX: num([p._rotationX, p.rotation_x, c.rotationX, m?.rotationX], 0),
        rotationY: num([p._rotationY, p.rotation_y, c.rotationY, m?.rotationY], 0),
        rotationZ: num([p._rotationZ, p.rotation_z, fieldRotZ, c.rotationZ, m?.rotationZ], 0),
        offsetX:   num([p._offsetX, p.offset_x, c.offsetX, m?.offsetX], 0),
        offsetY:   num([p._offsetY, p.offset_y, c.offsetY, m?.offsetY], 0),
        offsetZ:   num([p._offsetZ, p.offset_z, c.offsetZ, m?.offsetZ], 0),
        modelId,
    };
}

// ============================================================
// MAP (MapLibre)
// ============================================================
function initMap() {
    const _bm = BASEMAPS[STATE.settings.basemap] || BASEMAPS.liberty;
    map = new maplibregl.Map({
        container: 'map',
        style: _bm.style ? _bm.style() : _bm.url,
        center: [STATE.location.lng, STATE.location.lat],
        zoom: CONFIG.defaultZoom,
        pitch: CONFIG.defaultPitch,
        bearing: CONFIG.defaultBearing,
        antialias: true,
        maxPitch: 80,
    });

    map.on('load', onStyleReady);

    map.on('move', updateHUD);
    map.on('rotate', () => {
        $('compass-svg').style.transform = `rotate(${map.getBearing()}deg)`;
    });
    // OPTIM (EclExt) : ré-instancie les modèles dans l'emprise + invalide le cache d'élévation
    map.on('moveend', () => { Models3D.elevCache.clear(); Models3D.cull(); });

    setupInteraction();
}

function applyProjection() {
    if (!map || typeof map.setProjection !== 'function') return; // MapLibre < v5
    try { map.setProjection({ type: STATE.settings.projection || 'globe' }); } catch (e) {}
}

function onStyleReady() {
    // Projection (globe façon Google Earth, bascule auto vers mercator en zoom)
    applyProjection();
    // 3D buildings come with the Liberty style (fill-extrusion). Toggle visibility.
    applyBuildingVisibility();
    applyLabelsVisibility();

    // Terrain (source DEM choisie : terrarium mondial ou LIDAR HD IGN)
    addTerrainSource();
    applyTerrain();
    applySky();

    // Re-add the three.js custom layer
    if (!map.getLayer(Models3D.layerId)) map.addLayer(Models3D.makeLayer());

    // Reapply all data layers
    STATE.layers.forEach((l) => { addLayerToMap(l); });
    Models3D.rebuildScene();

    updateLighting();
    updateHUD();
}

function applyBuildingVisibility() {
    const vis = STATE.settings.buildings3D ? 'visible' : 'none';
    (map.getStyle().layers || []).forEach((l) => {
        if (l.type === 'fill-extrusion' && !l.id.startsWith('layer-')) { // pas les couches de données
            try { map.setLayoutProperty(l.id, 'visibility', vis); } catch (e) {}
        }
    });
}
function applyLabelsVisibility() {
    const vis = STATE.settings.labels ? 'visible' : 'none';
    (map.getStyle().layers || []).forEach((l) => {
        if (l.type === 'symbol' && !l.id.startsWith('layer-')) {
            try { map.setLayoutProperty(l.id, 'visibility', vis); } catch (e) {}
        }
    });
}
function addTerrainSource() {
    const cfg = TERRAIN_SOURCES[STATE.settings.terrainSource] || TERRAIN_SOURCES.terrarium;
    if (!map.getSource('terrain-dem')) {
        try {
            map.addSource('terrain-dem', { type: 'raster-dem', tiles: cfg.tiles, encoding: cfg.encoding, tileSize: cfg.tileSize, maxzoom: cfg.maxzoom, attribution: cfg.attribution });
        } catch (e) { /* ignore */ }
    }
}
function applyTerrain() {
    if (!map.getSource('terrain-dem')) return;
    if (STATE.settings.terrain3D) map.setTerrain({ source: 'terrain-dem', exaggeration: STATE.settings.terrainExaggeration });
    else map.setTerrain(null);
}
function setTerrainSource(src) {
    STATE.settings.terrainSource = src;
    if (!map) return;
    try { map.setTerrain(null); } catch (e) {}
    if (map.getSource('terrain-dem')) { try { map.removeSource('terrain-dem'); } catch (e) {} }
    addTerrainSource();
    if (STATE.settings.terrain3D) applyTerrain();
    Models3D.recomputeAll();
}
function applySky() {
    if (typeof map.setSky !== 'function') return;
    if (STATE.settings.sky) {
        map.setSky({ 'sky-color': '#bcd4e8', 'horizon-color': '#f3ecd9', 'fog-color': '#f3ecd9', 'fog-ground-blend': 0.4, 'horizon-fog-blend': 0.6, 'sky-horizon-blend': 0.6 });
    } else { try { map.setSky(null); } catch (e) {} }
}

function updateHUD() {
    if (!map) return;
    const c = map.getCenter();
    $('hud-coords').textContent = `${c.lat.toFixed(4)}°N · ${c.lng.toFixed(4)}°E`;
    $('hud-zoom').textContent = `zoom ${map.getZoom().toFixed(1)}`;
    $('hud-pitch').textContent = `pitch ${Math.round(map.getPitch())}°`;
}

// ============================================================
// ÉCLAIRAGE SOLAIRE (SunCalc → MapLibre light + three.js)
// ============================================================
function sunPosition() {
    const min = STATE.settings.timeOfDay;
    const d = new Date(STATE.settings.date);
    d.setHours(Math.floor(min / 60), min % 60, 0, 0);
    const c = map ? map.getCenter() : { lat: STATE.location.lat, lng: STATE.location.lng };
    let azimuth = 180, altitude = 45;
    if (typeof SunCalc !== 'undefined') {
        try {
            const s = SunCalc.getPosition(d, c.lat, c.lng);
            azimuth = ((s.azimuth * 180 / Math.PI) + 180) % 360;
            altitude = s.altitude * 180 / Math.PI;
        } catch (e) {}
    }
    return { azimuth, altitude, date: d };
}
function updateLighting() {
    if (!map) return;
    const { azimuth, altitude, date } = sunPosition();
    const c = map.getCenter();
    const moon = computeMoon(date, c.lat, c.lng);
    const amb = computeAmbient(altitude, moon);
    const polar = clamp(90 - altitude, 5, 88);
    try { map.setLight({ anchor: 'map', position: [1.2, azimuth, polar], color: amb.mapColor, intensity: amb.mapIntensity }); } catch (e) {}
    if (STATE.settings.sky && typeof map.setSky === 'function') {
        // atmosphere-blend : halo atmosphérique du globe en vue large, estompé en zoom
        try { map.setSky({ 'sky-color': amb.sky, 'horizon-color': amb.horizon, 'fog-color': amb.horizon, 'fog-ground-blend': 0.4, 'horizon-fog-blend': 0.6, 'sky-horizon-blend': 0.7, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 1, 9, 0] }); } catch (e) {}
    }
    Models3D.setSun(azimuth, altitude, moon);
    // Teinte nocturne de la scène (le fond vecteur ne s'assombrit pas seul) — atténuée par la lune
    const tint = clamp((6 - altitude) / 26, 0, 0.62) * (moon && moon.isUp ? (1 - moon.moonIntensity * 0.35) : 1);
    const nt = $('night-tint');
    if (nt) nt.style.background = tint <= 0.015 ? 'transparent' : `rgba(16,24,58,${tint.toFixed(3)})`;
    updateSunStrip();
}

function updateSunStrip() {
    const { azimuth, altitude, date } = sunPosition();
    const min = STATE.settings.timeOfDay;
    const h = Math.floor(min / 60), m = min % 60;
    $('sun-time').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('sun-date').textContent = date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    $('sun-alt').textContent = `${altitude.toFixed(0)}°`;
    // dot position along 06h..20h
    const r = clamp((min - 360) / (1200 - 360), 0, 1);
    const dot = $('sun-dot');
    dot.style.left = `${5 + r * 210}px`;
    dot.style.top = `${4 - Math.sin(r * Math.PI) * 16}px`;
    $('sun-arc-prog').setAttribute('stroke-dasharray', `${r * 280}, 1000`);
}

// ============================================================
// COUCHES — ajout sur la carte / styles
// ============================================================
function indexFeatures(layer) {
    (layer.geojson?.features || []).forEach((f, i) => {
        if (!f.properties) f.properties = {};
        f.properties._idx = i;
    });
}
function sourceData(layer) { return layer.geojson; }

function removeLayerGfx(layer) {
    if (!map) return;
    ['', '-outline', '-label', '-hit'].forEach((sfx) => {
        const id = layer.id + sfx;
        if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(layer.id)) map.removeSource(layer.id);
}

function addLayerToMap(layer) {
    if (!map || !map.isStyleLoaded()) return;
    indexFeatures(layer);
    removeLayerGfx(layer);
    map.addSource(layer.id, { type: 'geojson', data: sourceData(layer) });
    initSymbolization(layer);
    applyLayerStyle(layer);
    if (layer.visible === false) setLayerVisibility(layer, false);
    if ((layer.controls || []).some((c) => c.active)) applyControls(layer);
}

function applyLayerStyle(layer) {
    if (!map || !map.getSource(layer.id)) return;
    const g = layer.geometryType;
    if (g === 'Point' || g === 'MultiPoint') applyPointStyle(layer);
    else if (g === 'LineString' || g === 'MultiLineString') applyLineStyle(layer);
    else applyPolygonStyle(layer);
    updateLegend();
}

function colorExpression(layer, fallback) {
    const sym = initSymbolization(layer).color;
    if (sym.mode === 'categorized' && sym.field) {
        const cats = sym.categories.length ? sym.categories
            : getUniqueValues(layer, sym.field).map((v, i) => ({ value: v.value, color: paletteColor(sym.palette, i, 99), count: v.count }));
        sym.categories = cats;
        return buildColorMatch(sym.field, cats, sym.defaultColor);
    }
    if (sym.mode === 'graduated' && sym.field) {
        const r = getNumericRange(layer, sym.field);
        if (r.count) return buildColorGraduated(sym.field, [r.min, r.max], sym.colorRamp || sym.palette, sym.method);
    }
    // Style « cuit » par objet (couche liée à une table : colonne fill_color) :
    // règle (categorized/graduated) > par-objet > défaut couche.
    if (layer._perObjectColor) return ['coalesce', ['get', 'fill_color'], sym.value || fallback || layer.color];
    return sym.value || fallback || layer.color;
}

function applyPointStyle(layer) {
    const s = layer.style;
    ['', '-hit', '-label'].forEach((sfx) => { if (map.getLayer(layer.id + sfx)) map.removeLayer(layer.id + sfx); });
    const sym = initSymbolization(layer);

    if (s.mode === 'library' || s.mode === 'custom') {
        // 3D rendu par three.js ; petit cercle de hit discret pour clic/sélection,
        // qui s'estompe quand on zoome (là où la 3D prend le relais).
        map.addLayer({ id: layer.id, type: 'circle', source: layer.id, paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 3, 19, 4.5],
            'circle-color': layer.color,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.12, 16, 0.06, 18, 0.02],
            'circle-stroke-width': 0,
        }});
        Models3D.scheduleBuild();
    } else {
        // native circle
        let radius = sym.size.value || 8;
        if (sym.size.mode === 'graduated' && sym.size.field) {
            const r = getNumericRange(layer, sym.size.field);
            if (r.count) radius = buildNumGraduated(sym.size.field, [r.min, r.max], sym.size.outputRange, sym.size.method);
        }
        map.addLayer({ id: layer.id, type: 'circle', source: layer.id, paint: {
            'circle-radius': radius,
            'circle-color': colorExpression(layer),
            'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': 0.92,
        }});
    }
    addLabelLayer(layer);
}

function applyLineStyle(layer) {
    if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    const sym = initSymbolization(layer);
    let width = sym.size.value || 4;
    if (sym.size.mode === 'graduated' && sym.size.field) {
        const r = getNumericRange(layer, sym.size.field);
        if (r.count) width = buildNumGraduated(sym.size.field, [r.min, r.max], sym.size.outputRange, sym.size.method);
    }
    map.addLayer({ id: layer.id, type: 'line', source: layer.id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': colorExpression(layer), 'line-width': width, 'line-opacity': 0.9 } });
    addLabelLayer(layer);
}

function applyPolygonStyle(layer) {
    ['', '-outline'].forEach((sfx) => { if (map.getLayer(layer.id + sfx)) map.removeLayer(layer.id + sfx); });
    const s = layer.style; const sym = initSymbolization(layer);
    const extrude = s.polygonMode !== 'flat';
    if (extrude) {
        let height = sym.size.value || 12;
        if (sym.size.mode === 'graduated' && sym.size.field) {
            const r = getNumericRange(layer, sym.size.field);
            if (r.count) height = buildNumGraduated(sym.size.field, [r.min, r.max], sym.size.outputRange, sym.size.method);
        } else if (layer.heightField) height = ['to-number', ['get', layer.heightField]];
        map.addLayer({ id: layer.id, type: 'fill-extrusion', source: layer.id, paint: {
            'fill-extrusion-color': colorExpression(layer),
            'fill-extrusion-height': height,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 1,
        }});
    } else {
        map.addLayer({ id: layer.id, type: 'fill', source: layer.id, paint: {
            'fill-color': colorExpression(layer), 'fill-opacity': 0.55 } });
        map.addLayer({ id: layer.id + '-outline', type: 'line', source: layer.id, paint: {
            'line-color': layer.color, 'line-width': 1.5 } });
    }
    addLabelLayer(layer);
}

function addLabelLayer(layer) {
    if (map.getLayer(layer.id + '-label')) map.removeLayer(layer.id + '-label');
    const sym = layer.style?.symbolization?.label;
    if (!sym?.enabled || !sym.field) return;
    map.addLayer({ id: layer.id + '-label', type: 'symbol', source: layer.id,
        layout: { 'text-field': ['to-string', ['get', sym.field]], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] },
        paint: { 'text-color': '#2D2820', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
}

function setLayerVisibility(layer, visible) {
    layer.visible = visible;
    const vis = visible ? 'visible' : 'none';
    ['', '-outline', '-label'].forEach((sfx) => {
        if (map.getLayer(layer.id + sfx)) map.setLayoutProperty(layer.id + sfx, 'visibility', vis);
    });
    Models3D.scheduleBuild();
}

// ============================================================
// MODULES — chrome contextuel
// ============================================================
const MODULE_TITLES = { lieu: '📍 Lieu', couches: 'Couches', controles: '🎛️ Contrôles', recit: '📖 Récit', soleil: '☀️ Soleil', vues: 'Vue & rendu', reglages: '⚙️ Catalogue 3D' };

function openModule(name) {
    STATE.currentModule = name;
    document.querySelectorAll('.rail-item').forEach((b) => b.classList.toggle('active', b.dataset.module === name));
    $('module-title').textContent = (MODULE_TITLES[name] || name).replace(/^[^ ]+ /, (m) => m); // keep emoji
    $('module-panel').classList.add('open');
    $('module-foot').style.display = 'none';

    if (name === 'lieu') renderLieu();
    else if (name === 'couches') { renderLayersPanel(name); refreshGeoTables(); }
    else if (name === 'controles') renderControles();
    else if (name === 'recit') renderRecit();
    else if (name === 'reglages') renderModelsPanel();
    else if (name === 'soleil') renderSoleil();
    else if (name === 'vues') renderVues();

    renderInspector();
}
function closeModulePanel() {
    $('module-panel').classList.remove('open');
    document.querySelectorAll('.rail-item').forEach((b) => b.classList.remove('active'));
    STATE.currentModule = null;
    renderInspector();
}

// ---- Lieu ----
let searchTimer = null;
let locationPickMode = false;
function renderLieu() {
    $('module-title').textContent = '📍 Lieu';
    const L = STATE.location;
    $('module-body').innerHTML = `
        <div class="loc-badge">
            <span class="ic">📌</span>
            <div>
                <div class="nm">${L.name || 'Non défini'}</div>
                <div class="co">${(L.lat ?? 0).toFixed(5)}°N · ${(L.lng ?? 0).toFixed(5)}°E</div>
            </div>
            <button class="loc-change" onclick="A.recenter()">Recentrer</button>
        </div>
        <div class="section">
            <div class="section-title">Rechercher un lieu</div>
            <input class="input" id="loc-search" placeholder="🔍 Adresse, ville, monument…" oninput="A.searchLocation(this.value)">
            <div class="search-results" id="loc-results"></div>
        </div>
        <div class="section">
            <button class="btn btn-soft btn-full" onclick="A.useGeolocation()">📍 Ma position actuelle</button>
            <button class="btn btn-soft btn-full" style="margin-top:8px" onclick="A.pickOnMap()">🗺️ Pointer sur la carte</button>
        </div>
        <div class="section">
            <div class="section-title">Coordonnées manuelles</div>
            <div class="dual">
                <div><label class="input-label">Latitude</label><input class="input" id="loc-lat" type="number" step="0.0001" value="${(L.lat ?? '').toString()}"></div>
                <div><label class="input-label">Longitude</label><input class="input" id="loc-lng" type="number" step="0.0001" value="${(L.lng ?? '').toString()}"></div>
            </div>
            <button class="btn btn-soft btn-full" style="margin-top:10px" onclick="A.applyManualCoords()">Aller</button>
        </div>
        <div class="section">
            <div class="section-title">Zone de travail</div>
            <div class="option-cards">
                ${[200, 500, 1000, 2000].map((r) => `<div class="option-card ${L.radius === r ? 'active' : ''}" onclick="A.setRadius(${r})"><div class="oc-label">${r < 1000 ? r + 'm' : r / 1000 + 'km'}</div></div>`).join('')}
            </div>
        </div>
        <div class="section">
            <div class="section-title">Nom du projet</div>
            <input class="input" id="proj-name" placeholder="Ma maquette…" value="${STATE.projectName}" onchange="A.setProjectName(this.value)">
        </div>`;
}

// ---- Couches (liste + symbolisation via l'inspecteur de droite) ----
// Tables géo du document détectées (cache), proposées à afficher dans Couches.
let _geoTables = [];
async function refreshGeoTables() {
    if (!CONFIG.grist.ready) { _geoTables = []; return; }
    try { _geoTables = await scanGeoTables(); } catch (e) { _geoTables = []; }
    if (STATE.currentModule === 'couches') renderLayersPanel('couches');
}
function availableTablesSection() {
    if (!CONFIG.grist.ready) return '';
    const linked = new Set(STATE.layers.filter((l) => l.kind === 'table').map((l) => l.sourceTable));
    const avail = _geoTables.filter((g) => !linked.has(g.table));
    if (!avail.length) return '';
    return `<div class="section"><div class="section-title">Tables géo du document · à afficher</div><div class="layer-list">${avail.map((g) => `
        <div class="layer-item" onclick="A.showGeoTable('${String(g.table).replace(/'/g, "\\'")}')">
            <span class="layer-vis" title="Afficher comme couche">＋</span>
            <div class="layer-info"><div class="layer-name">${g.table}</div><div class="layer-meta"><span>${g.count} obj.</span><span class="badge3d">${g.geomType}</span></div></div>
            <button class="layer-act" title="Afficher">👁</button>
        </div>`).join('')}</div></div>`;
}
function renderLayersPanel(mode) {
    $('module-title').textContent = 'Couches';
    const body = $('module-body');
    if (STATE.layers.length === 0) {
        body.innerHTML = `
            <div class="empty"><div class="ic">📂</div><div class="t">Aucune couche affichée</div><div class="h">Affiche une table ci-dessous, ou importe</div></div>
            ${availableTablesSection()}
            <div class="section"><div class="section-title">🌍 OpenStreetMap</div><button class="btn btn-primary btn-full" onclick="A.openOSM()">Importer depuis OSM</button></div>
            <div class="section"><div class="section-title">📄 Fichier</div>
                <div class="drop" id="drop" onclick="document.getElementById('file-input').click()"><div class="ic">📄</div><div class="t">Glissez un GeoJSON</div><div class="h">.geojson / .json</div></div>
            </div>`;
        wireDrop();
        return;
    }
    const allVis = STATE.layers.every((l) => l.visible !== false);
    body.innerHTML = `
        <div class="section" style="margin-top:0">
            <div style="display:flex;gap:8px">
                <button class="btn ${allVis ? 'btn-dark' : 'btn-soft'}" style="flex:1" onclick="A.toggleAllLayers(true)">👁 Tout</button>
                <button class="btn ${!STATE.layers.some((l) => l.visible !== false) ? 'btn-dark' : 'btn-soft'}" style="flex:1" onclick="A.toggleAllLayers(false)">Masquer</button>
            </div>
        </div>
        <div class="layer-list">
            ${STATE.layers.map((l) => {
                const is3D = l.style?.mode === 'library' || l.style?.mode === 'custom';
                const visible = l.visible !== false;
                return `<div class="layer-item ${STATE.selectedLayer === l.id ? 'active' : ''}" onclick="A.selectLayer('${l.id}')">
                    <span class="layer-vis ${visible ? 'on' : ''}" onclick="A.toggleLayer('${l.id}', event)">${visible ? '👁' : '🚫'}</span>
                    <span class="layer-swatch" style="background:${l.color}"></span>
                    <div class="layer-info">
                        <div class="layer-name">${l.name}</div>
                        <div class="layer-meta"><span>${l.geojson?.features?.length || 0} obj.</span>${is3D ? '<span class="badge3d">3D</span>' : ''}${l.kind === 'table' ? '<span class="badge-saved">⛓ table</span>' : (l.gristId ? '<span class="badge-saved">Grist</span>' : '')}</div>
                    </div>
                    ${l.kind === 'table' ? `<button class="layer-act" onclick="A.refreshLayer('${l.id}', event)" title="Rafraîchir depuis la table">🔄</button>` : ''}
                    <button class="layer-act" onclick="A.zoomLayer('${l.id}', event)" title="Zoomer sur la couche">🎯</button>
                    <button class="layer-del" onclick="A.deleteLayer('${l.id}', event)" title="Supprimer">🗑️</button>
                </div>`;
            }).join('')}
        </div>
        ${availableTablesSection()}
        <div class="section">
            <div style="display:flex;gap:8px">
                <button class="btn btn-primary" style="flex:1" onclick="A.openOSM()">🌍 OSM</button>
                <button class="btn btn-soft" style="flex:1" onclick="document.getElementById('file-input').click()">📄 Fichier</button>
                ${CONFIG.grist.ready ? `<button class="btn btn-soft" style="flex:1" onclick="A.openLinkTable()">🔗 Table</button>` : ''}
            </div>
        </div>`;
}

// ---- Modèles 3D ----
// Module Modèles = gestion du CATALOGUE pour l'app (jeu, source, galerie).
// Le CHOIX du modèle d'une couche se fait dans l'inspecteur (onglet Modèle 3D).
function renderModelsPanel() {
    $('module-title').textContent = 'Catalogue 3D';
    const nModels = allModels().length;
    const layer = STATE.layers.find((l) => l.id === STATE.selectedLayer);
    const isPoint = layer && (layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint');
    const banner = isPoint
        ? `<div class="hint" style="border-left-color:var(--accent)">Couche sélectionnée : <strong>${layer.name}</strong>.<button class="btn btn-primary btn-full" style="margin-top:8px" onclick="A.openLayerModel('${layer.id}')">→ Choisir le modèle de cette couche</button></div>`
        : `<div class="hint">⚙️ Réglages du catalogue, valables pour toute l'app. Pour <strong>affecter un modèle à une couche</strong> : sélectionne une couche de points (module Couches) → onglet <strong>Modèle 3D</strong> de l'inspecteur.</div>`;
    $('module-body').innerHTML = banner + `
        <div class="section">
            <div class="section-title">Jeu de modèles</div>
            <div class="seg">
                <button class="${MODEL_LIBRARY.set === 'colored' ? 'active' : ''}" onclick="A.setModelSet('colored')">🎨 Coloré</button>
                <button class="${MODEL_LIBRARY.set === 'mono' ? 'active' : ''}" onclick="A.setModelSet('mono')">⬜ Maquette</button>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Source des modèles (GLB)</div>
            <div class="range-info" id="model-src-info" style="word-break:break-all">${MODEL_LIBRARY.baseUrl}</div>
            <input class="input" id="model-src-input" style="margin-top:6px;font-family:var(--mono);font-size:11px" value="${MODEL_LIBRARY.baseRoot}" placeholder="https://…/models/">
            <div style="display:flex;gap:6px;margin-top:6px">
                <button class="btn btn-soft" style="flex:1" onclick="A.testModelBase()">Tester</button>
                <button class="btn btn-primary" style="flex:1" onclick="A.setModelBase(document.getElementById('model-src-input').value)">Appliquer</button>
            </div>
            <div class="hint" style="margin-top:6px">Doit contenir <code>colored/</code>, <code>mono/</code> et <code>catalog.json</code>. En local : sers la racine du repo et ouvre <code>/projects/Atlas/index.html</code>.</div>
        </div>
        <div class="section">
            <div class="section-title">Contribuer un modèle</div>
            <div class="hint">Pour ajouter un objet au <strong>catalogue partagé</strong> : dépose ton <code>.glb</code> (low-poly, en mètres, base au sol) dans <code>published/atlas/models/</code>, lance <code>npm run models</code> (régénère <code>catalog.json</code>) et ouvre une PR. <em>Pour un usage ponctuel, importe le <code>.glb</code> directement sur un objet (inspecteur → 📎).</em></div>
            <a class="btn btn-soft btn-full" style="margin-top:6px" href="https://github.com/nicO1asFr/Widgets-Grist/tree/main/published/atlas/models" target="_blank" rel="noopener">📂 Dossier des modèles (GitHub)</a>
        </div>
        <div class="section">
            <div class="section-title">Catalogue · ${nModels} modèles</div>
            ${Object.entries(MODEL_LIBRARY.categories).map(([k, c]) => `
                <div style="margin:10px 0 4px;font-size:10.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em">${c.icon} ${c.name} <span style="color:var(--muted-light)">· ${c.models.length}</span></div>
                <div class="model-grid">${c.models.map((m) => `<div class="model-card" title="${m.name}" style="cursor:default"><div class="mi">${m.icon}</div><div class="mn">${m.name}</div></div>`).join('')}</div>
            `).join('')}
        </div>`;
}

// ---- Soleil / Ambiance ----
function renderSoleil() {
    $('module-title').textContent = '☀️ Soleil';
    const min = STATE.settings.timeOfDay;
    const d = STATE.settings.date;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const { azimuth, altitude } = sunPosition();
    const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(azimuth / 45) % 8];
    $('module-body').innerHTML = `
        <div class="section">
            <div class="section-title">Moment de la journée</div>
            <div class="option-cards grid2">
                <div class="option-card" onclick="A.timePreset('dawn')"><div class="oc-icon">🌅</div><div class="oc-label">Aube</div></div>
                <div class="option-card" onclick="A.timePreset('day')"><div class="oc-icon">☀️</div><div class="oc-label">Midi</div></div>
                <div class="option-card" onclick="A.timePreset('dusk')"><div class="oc-icon">🌆</div><div class="oc-label">Soir</div></div>
                <div class="option-card" onclick="A.timePreset('night')"><div class="oc-icon">🌙</div><div class="oc-label">Nuit</div></div>
            </div>
        </div>
        <div class="section">
            <div class="slider-head"><span class="lbl">Heure</span><span class="val">${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}</span></div>
            <input type="range" class="rng acc" min="0" max="1439" step="5" value="${min}" oninput="A.setTime(this.value)">
        </div>
        <div class="section">
            <div class="section-title">📅 Date</div>
            <input class="input" type="date" value="${dateStr}" onchange="A.setSunDate(this.value)">
        </div>
        <div class="section">
            <div class="range-info">📍 Soleil : <strong>${azimuth.toFixed(0)}° ${cardinal}</strong> · Hauteur <strong>${altitude.toFixed(1)}°</strong></div>
        </div>
        <div class="section">
            <div class="toggle-row"><span class="tlabel">Ombres portées</span><div class="toggle ${STATE.settings.shadows ? 'on' : ''}" onclick="A.toggleSetting('shadows')"></div></div>
            <div class="hint" style="margin-top:8px">💡 Vraies ombres des modèles 3D (direction = position solaire SunCalc), au zoom rue, ${STATE.settings.terrain3D ? '<strong>désactivées car le relief 3D est actif</strong>' : 'jusqu’à 1500 objets visibles'}. Le bâti n’a pas d’ombre (limite MapLibre).</div>
        </div>`;
}

// ---- Vue & rendu ----
function renderVues() {
    $('module-title').textContent = 'Vue & rendu';
    const s = STATE.settings;
    $('module-body').innerHTML = `
        <div class="section">
            <div class="section-title">Points de vue</div>
            <div class="option-cards">
                <div class="option-card" onclick="A.viewPreset('top')"><div class="oc-icon">⬇️</div><div class="oc-label">Dessus</div></div>
                <div class="option-card" onclick="A.viewPreset('3d')"><div class="oc-icon">🎯</div><div class="oc-label">3D</div></div>
                <div class="option-card" onclick="A.viewPreset('street')"><div class="oc-icon">🚶</div><div class="oc-label">Piéton</div></div>
            </div>
        </div>
        <div class="section">
            <div class="slider-head"><span class="lbl">Inclinaison</span><span class="val" id="v-pitch">${Math.round(map?.getPitch() || 55)}°</span></div>
            <input type="range" class="rng" min="0" max="80" step="1" value="${Math.round(map?.getPitch() || 55)}" oninput="A.setPitch(this.value)">
            <div class="slider-head" style="margin-top:12px"><span class="lbl">Rotation</span><span class="val" id="v-bearing">${Math.round(map?.getBearing() || 0)}°</span></div>
            <input type="range" class="rng" min="-180" max="180" step="1" value="${Math.round(map?.getBearing() || 0)}" oninput="A.setBearing(this.value)">
        </div>
        <div class="section">
            <div class="section-title">Projection</div>
            <div class="seg">
                <button class="${s.projection === 'globe' ? 'active' : ''}" onclick="A.setProjection('globe')">🌍 Globe</button>
                <button class="${s.projection === 'mercator' ? 'active' : ''}" onclick="A.setProjection('mercator')">🗺️ Plan</button>
            </div>
            <div class="hint" style="margin-top:8px">Le globe (façon Google Earth) bascule automatiquement en plan une fois zoomé sur la zone.</div>
        </div>
        <div class="section">
            <div class="section-title">Fond de carte</div>
            <div class="option-cards grid2">
                ${Object.entries(BASEMAPS).map(([k, b]) => `<div class="option-card ${s.basemap === k ? 'active' : ''}" onclick="A.setBasemap('${k}')"><div class="oc-icon">${b.icon}</div><div class="oc-label">${b.label}</div></div>`).join('')}
            </div>
        </div>
        <div class="section">
            <div class="section-title">Rendu 3D</div>
            <div class="toggle-row"><span class="tlabel">🏢 Bâtiments 3D</span><div class="toggle ${s.buildings3D ? 'on' : ''}" onclick="A.toggleSetting('buildings3D')"></div></div>
            <div class="toggle-row"><span class="tlabel">⛰️ Terrain 3D</span><div class="toggle ${s.terrain3D ? 'on' : ''}" onclick="A.toggleSetting('terrain3D')"></div></div>
            <label class="input-label" style="margin-top:6px">Source du relief</label>
            <select class="input" onchange="A.setTerrainSource(this.value)">
                ${Object.entries(TERRAIN_SOURCES).map(([k, t]) => `<option value="${k}" ${s.terrainSource === k ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
            <div class="slider-head" style="margin-top:8px"><span class="lbl">Exagération relief</span><span class="val" id="v-exag">${s.terrainExaggeration}×</span></div>
            <input type="range" class="rng" min="1" max="3" step="0.1" value="${s.terrainExaggeration}" oninput="A.setExag(this.value)">
            <div class="toggle-row"><span class="tlabel">🏷️ Étiquettes</span><div class="toggle ${s.labels ? 'on' : ''}" onclick="A.toggleSetting('labels')"></div></div>
            <div class="toggle-row"><span class="tlabel">🌫️ Ciel / atmosphère</span><div class="toggle ${s.sky ? 'on' : ''}" onclick="A.toggleSetting('sky')"></div></div>
        </div>
        <button class="btn btn-soft btn-full" onclick="A.resetView()">🔄 Réinitialiser la vue</button>`;
}

// ============================================================
// LEGEND
// ============================================================
function updateLegend() {
    const body = $('legend-body');
    const vis = STATE.layers.filter((l) => l.visible !== false);
    if (vis.length === 0) { body.innerHTML = '<div class="legend-empty">Aucune couche visible</div>'; return; }
    body.innerHTML = vis.map((l) => `<div class="legend-row"><span class="swatch" style="background:${l.color}"></span><span class="nm">${l.name}</span><span class="ct">${l.geojson?.features?.length || 0}</span></div>`).join('');
}

// ============================================================
// INSPECTOR — symbologie ou objet sélectionné
// ============================================================
function renderInspector() {
    const insp = $('inspector');
    if (STATE.selection.mode && STATE.selection.features.length > 0) { renderObjectInspector(); insp.classList.add('open'); return; }
    if (STATE.currentModule === 'couches' && STATE.selectedLayer) {
        const layer = STATE.layers.find((l) => l.id === STATE.selectedLayer);
        if (layer) { renderSymbologyInspector(layer); insp.classList.add('open'); return; }
    }
    insp.classList.remove('open');
}

let inspSymTab = 'Couleur';
function renderSymbologyInspector(layer) {
    const sym = initSymbolization(layer);
    const isPoint = layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint';
    const tabs = ['Couleur', 'Taille'];
    if (isPoint) tabs.push('Modèle 3D');
    tabs.push('Étiquette');
    if (!tabs.includes(inspSymTab)) inspSymTab = 'Couleur';

    // Chip du modèle 3D lié à la couche (toujours visible dans l'inspecteur)
    const is3D = isPoint && (layer.style?.mode === 'library' || layer.style?.mode === 'custom');
    let modelChip = '';
    if (is3D) {
        const mm = sym.model || {};
        let label, icon = '📦';
        if (mm.mode === 'categorized' && mm.field) { label = `par champ « ${mm.field} »`; }
        else if (layer.style?.mode === 'custom' && layer.style.custom?.filename) { label = layer.style.custom.filename; }
        else { const m = findModel(layer.style?.library?.modelId); icon = m?.icon || '📦'; label = m ? m.name : 'aucun modèle'; }
        modelChip = `<div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <span style="display:inline-flex;align-items:center;gap:6px;background:var(--accent-soft);border:1px solid rgba(196,69,54,0.2);border-radius:8px;padding:4px 10px;font-size:12px;color:var(--ink)"><span style="font-size:15px">${icon}</span>${label}</span>
            <button onclick="A.openLayerModel('${layer.id}')" style="background:transparent;border:none;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer">changer</button>
        </div>`;
    }
    $('insp-head').innerHTML = `
        <div class="insp-eyebrow"><span class="layer-swatch" style="background:${layer.color}"></span>Symboliser${is3D ? ' · <span style="color:var(--accent2)">3D</span>' : ''}</div>
        <div class="insp-title">${layer.name}</div>
        <div class="insp-sub">${layer.geojson?.features?.length || 0} objets · ${layer.geometryType}</div>
        ${modelChip}
        ${isPoint ? `<button class="btn btn-soft btn-full" style="margin-top:8px" onclick="A.editLayerObjects('${layer.id}')">✏️ Éditer les objets un par un</button>` : ''}`;
    $('insp-tabs').innerHTML = tabs.map((t) => `<button class="insp-tab ${inspSymTab === t ? 'active' : ''}" onclick="A.setSymTab('${t}')">${t}</button>`).join('');

    const body = $('insp-body');
    if (inspSymTab === 'Couleur') body.innerHTML = symColorPanel(layer, sym);
    else if (inspSymTab === 'Taille') body.innerHTML = symSizePanel(layer, sym);
    else if (inspSymTab === 'Modèle 3D') body.innerHTML = symModelPanel(layer, sym);
    else body.innerHTML = symLabelPanel(layer, sym);

    $('insp-foot').innerHTML = `
        <button class="btn btn-soft" style="flex:1" onclick="A.resetSymbology('${layer.id}')">Réinitialiser</button>
        <button class="btn btn-soft" style="flex:1" onclick="A.exportLayerQGIS('${layer.id}')" title="Exporter GeoJSON + style QML pour QGIS">⬇ QGIS</button>
        <button class="btn btn-primary" style="flex:2" onclick="A.saveLayer('${layer.id}')">Enregistrer</button>`;
}

function fieldSelect(layer, param, current, type) {
    const fields = getLayerFields(layer).filter((f) => !type || f.type === type);
    return `<select class="input" onchange="A.setSymField('${layer.id}','${param}', this.value)">
        <option value="">— Champ —</option>
        ${fields.map((f) => `<option value="${f.id}" ${current === f.id ? 'selected' : ''}>${f.id} (${f.type === 'numeric' ? '123' : 'abc'})</option>`).join('')}
    </select>`;
}
function modeSeg(layer, param, mode, modes) {
    const lbl = { single: 'Fixe', categorized: 'Catégorisé', graduated: 'Gradué' };
    return `<div class="seg">${modes.map((m) => `<button class="${mode === m ? 'active' : ''}" onclick="A.setSymMode('${layer.id}','${param}','${m}')">${lbl[m]}</button>`).join('')}</div>`;
}
function methodChips(layer, param, method) {
    return `<div class="chips" style="margin-top:8px">${[['linear', 'Linéaire'], ['log', 'Log'], ['sqrt', '√']].map(([id, l]) => `<button class="chip ${method === id ? 'active' : ''}" onclick="A.setSymMethod('${layer.id}','${param}','${id}')">${l}</button>`).join('')}</div>`;
}
function paletteList(layer, param, current, type) {
    const items = Object.entries(PALETTE_INFO).filter(([, i]) => type === 'all' || i.type === type);
    return `<div class="palette-list" style="margin-top:8px">${items.map(([id, info]) => `
        <div class="palette-item ${current === id ? 'active' : ''}" onclick="A.setSymPalette('${layer.id}','${param}','${id}')">
            <div class="palette-strip">${(COLOR_PALETTES[id] || []).map((c) => `<span style="background:${c}"></span>`).join('')}</div>
            <span class="pname">${info.name}</span>
        </div>`).join('')}</div>`;
}

function symColorPanel(layer, sym) {
    const c = sym.color;
    let inner = '';
    if (c.mode === 'single') {
        inner = `<div class="section"><div class="section-title">Couleur</div>
            <div style="display:flex;gap:8px;align-items:center">
                <input type="color" value="${c.value || layer.color}" style="width:40px;height:34px;border:none;cursor:pointer" onchange="A.setSymColorValue('${layer.id}', this.value)">
                <input class="input" style="flex:1;font-family:var(--mono)" value="${c.value || layer.color}" onchange="A.setSymColorValue('${layer.id}', this.value)">
            </div></div>`;
    } else if (c.mode === 'categorized') {
        inner = `<div class="section"><div class="section-title">Champ source</div>${fieldSelect(layer, 'color', c.field, null)}</div>
            ${c.field ? `<div class="section"><div class="section-title">Palette</div>${paletteList(layer, 'color', c.palette, 'qualitative')}</div>
            <div class="section"><div class="section-title">Catégories</div>${categoriesPreview(layer, c)}</div>` : ''}`;
    } else {
        inner = `<div class="section"><div class="section-title">Champ source</div>${fieldSelect(layer, 'color', c.field, 'numeric')}
            ${c.field ? rangeInfo(layer, c.field) : ''}</div>
            ${c.field ? `<div class="section"><div class="section-title">Palette</div>${paletteList(layer, 'color', c.colorRamp || c.palette, 'sequential')}${methodChips(layer, 'color', c.method)}</div>` : ''}`;
    }
    return `<div class="section"><div class="section-title">Mode</div>${modeSeg(layer, 'color', c.mode, ['single', 'categorized', 'graduated'])}</div>${inner}`;
}
function categoriesPreview(layer, c) {
    const vals = getUniqueValues(layer, c.field, 100);
    if (!vals.length) return '<div class="range-info">Aucune valeur</div>';
    if (!c.categories.length) c.categories = vals.map((v, i) => ({ value: v.value, color: paletteColor(c.palette, i, vals.length), count: v.count }));
    return `<div class="cats">${vals.slice(0, 30).map((v, i) => {
        const cat = c.categories.find((x) => String(x.value) === String(v.value));
        const col = cat?.color || paletteColor(c.palette, i, vals.length);
        return `<div class="cat-row"><span class="cat-swatch" style="background:${col}" onclick="A.pickCatColor('${layer.id}','${String(v.value).replace(/'/g, "\\'")}', this)"></span><span class="cat-value" title="${v.value}">${v.value}</span><span class="cat-count">${v.count}</span></div>`;
    }).join('')}${vals.length > 30 ? `<div class="range-info" style="margin-top:6px">+ ${vals.length - 30} autres</div>` : ''}</div>`;
}
function rangeInfo(layer, field) {
    const r = getNumericRange(layer, field);
    if (!r.count) return '<div class="range-info">⚠️ Pas de valeurs numériques</div>';
    return `<div class="range-info" style="margin-top:6px">Valeurs : <strong>${r.min.toFixed(1)}</strong> → <strong>${r.max.toFixed(1)}</strong> (${r.count} obj.)</div>`;
}

function symSizePanel(layer, sym) {
    const s = sym.size;
    const isPoint = layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint';
    const is3D = isPoint && (layer.style?.mode === 'library' || layer.style?.mode === 'custom');
    const unit = is3D ? '×' : (layer.geometryType === 'Polygon' ? 'm' : 'px');
    const title = is3D ? 'Échelle' : (layer.geometryType === 'Polygon' ? 'Hauteur extrusion' : layer.geometryType === 'Point' ? 'Rayon' : 'Épaisseur');
    let inner = '';
    if (s.mode === 'single') {
        inner = `<div class="section"><div class="slider-head"><span class="lbl">${title}</span><span class="val" id="sz-val">${s.value} ${unit}</span></div>
            <input type="range" class="rng acc" min="${is3D ? 0.1 : 1}" max="${is3D ? 5 : layer.geometryType === 'Polygon' ? 150 : 30}" step="${is3D ? 0.1 : 0.5}" value="${s.value}" oninput="A.setSymSizeValue('${layer.id}', this.value)"></div>`;
    } else {
        inner = `<div class="section"><div class="section-title">Champ source</div>${fieldSelect(layer, 'size', s.field, 'numeric')}${s.field ? rangeInfo(layer, s.field) : ''}</div>
            ${s.field ? `<div class="section"><div class="section-title">Méthode</div>${methodChips(layer, 'size', s.method)}</div>
            <div class="section"><div class="section-title">Plage de sortie (${unit})</div><div class="dual">
                <div><label class="input-label">Min</label><input class="input" type="number" step="0.1" value="${s.outputRange[0]}" onchange="A.setSymOutput('${layer.id}','size',0,this.value)"></div>
                <div><label class="input-label">Max</label><input class="input" type="number" step="0.1" value="${s.outputRange[1]}" onchange="A.setSymOutput('${layer.id}','size',1,this.value)"></div>
            </div></div>` : ''}`;
    }
    return `<div class="section"><div class="section-title">Mode</div>${modeSeg(layer, 'size', s.mode, ['single', 'graduated'])}</div>${inner}`;
}

function symModelPanel(layer, sym) {
    const m = sym.model;
    const is3D = layer.style?.mode === 'library' || layer.style?.mode === 'custom';
    // Représentation de la couche : cercle 2D (Mapbox) ou modèle 3D
    const repr = `<div class="section"><div class="section-title">Représentation</div>
        <div class="seg">
            <button class="${!is3D ? 'active' : ''}" onclick="A.setRepresentation('${layer.id}','mapbox')">⬤ Cercle 2D</button>
            <button class="${is3D ? 'active' : ''}" onclick="A.setRepresentation('${layer.id}','library')">📦 Modèle 3D</button>
        </div></div>`;
    if (!is3D) return repr + `<div class="hint">Couche en cercles 2D (couleur/taille dans les onglets dédiés). Passe en « Modèle 3D » pour choisir un objet du catalogue.</div>`;

    const cat = layer._modelCat || 'lighting';
    const grid = MODEL_LIBRARY.categories[cat].models;
    const selId = layer.style?.library?.modelId;
    const models = allModels();
    let inner;
    if (m.mode === 'single') {
        inner = `<div class="section"><div class="section-title">Catégorie</div>
            <select class="input" onchange="A.setModelCat('${layer.id}', this.value)">${Object.entries(MODEL_LIBRARY.categories).map(([k, c]) => `<option value="${k}" ${cat === k ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></div>
            <div class="section"><div class="section-title">Modèle de la couche</div>
            <div class="model-grid">${grid.map((mm) => `<div class="model-card ${selId === mm.id ? 'active' : ''}" onclick="A.pickModel('${layer.id}','${mm.id}')"><div class="mi">${mm.icon}</div><div class="mn">${mm.name}</div></div>`).join('')}</div></div>`;
    } else {
        inner = `<div class="section"><div class="section-title">Champ source</div>${fieldSelect(layer, 'model', m.field, 'text')}</div>
            ${m.field ? `<div class="section"><div class="section-title">Modèle par valeur</div><div class="cats">${getUniqueValues(layer, m.field, 20).map((v) => {
                const c2 = m.categories.find((c) => String(c.value) === String(v.value));
                return `<div class="cat-row"><span class="cat-icon">${findModel(c2?.modelId)?.icon || '❓'}</span><span class="cat-value" title="${v.value}">${v.value}</span>
                    <select class="cat-select" onchange="A.setModelCategory('${layer.id}','${String(v.value).replace(/'/g, "\\'")}', this.value)"><option value="">—</option>${models.map((mm) => `<option value="${mm.id}" ${c2?.modelId === mm.id ? 'selected' : ''}>${mm.icon} ${mm.name}</option>`).join('')}</select>
                    <span class="cat-count">${v.count}</span></div>`;
            }).join('')}</div></div>
            <div class="section"><div class="section-title">Modèle par défaut</div><select class="input" onchange="A.setDefaultModel('${layer.id}', this.value)"><option value="">— Aucun —</option>${models.map((mm) => `<option value="${mm.id}" ${m.defaultModelId === mm.id ? 'selected' : ''}>${mm.icon} ${mm.name}</option>`).join('')}</select></div>` : ''}`;
    }
    return repr
        + `<div class="section"><div class="section-title">Affectation</div>${modeSeg(layer, 'model', m.mode, ['single', 'categorized'])}</div>`
        + inner + commonTransform(layer);
}
function commonTransform(layer) {
    const c = layer.style.common = layer.style.common || { scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0 };
    return `<div class="section"><div class="section-title">⚙️ Transform couche</div>
        <div class="slider-head"><span class="lbl">Échelle</span><span class="val" id="ct-scale">${c.scale}×</span></div>
        <input type="range" class="rng acc" min="0.1" max="5" step="0.1" value="${c.scale}" oninput="A.setCommon('${layer.id}','scale',this.value,'ct-scale','×')">
        <div class="slider-head" style="margin-top:12px"><span class="lbl">Rotation Z (azimut)</span><span class="val" id="ct-rz">${c.rotationZ}°</span></div>
        <input type="range" class="rng acc" min="0" max="360" step="5" value="${c.rotationZ}" oninput="A.setCommon('${layer.id}','rotationZ',this.value,'ct-rz','°')">
        <div class="slider-head" style="margin-top:12px"><span class="lbl">Altitude (Z)</span><span class="val" id="ct-oz">${c.offsetZ}m</span></div>
        <input type="range" class="rng acc" min="0" max="30" step="0.5" value="${c.offsetZ}" oninput="A.setCommon('${layer.id}','offsetZ',this.value,'ct-oz','m')">
        <div class="slider-head" style="margin-top:12px"><span class="lbl">🧭 Orientation depuis un champ</span></div>
        <select class="input" onchange="A.setOrientationField('${layer.id}', this.value)"><option value="">— azimut fixe ci-dessus —</option>${layerFieldNames(layer).map((fn) => `<option value="${fn}" ${layer.style?.symbolization?.orientation?.field === fn ? 'selected' : ''}>${fn}</option>`).join('')}</select>
    </div>`;
}
// Noms de champs d'attributs d'une couche (hors internes).
function layerFieldNames(layer) {
    const p = layer.geojson?.features?.[0]?.properties || {};
    return Object.keys(p).filter((k) => !k.startsWith('_') && k !== 'geometry_json');
}
// ---- Module Contrôles (filtres/animation par champ) ----
function fmtCtl(c, n) { return c.type === 'time' ? new Date(n).toLocaleDateString('fr-FR') : (Math.round(n * 100) / 100); }
function renderControlBody(layer, c) {
    const esc = (s) => String(s).replace(/'/g, "\\'");
    if (c.type === 'select') {
        const vals = getUniqueValues(layer, c.field, 30);
        const sel = new Set(c.values || vals.map((v) => v.value));
        return `<div class="cats" style="margin-top:6px">${vals.map((v) => `<label class="cat-row" style="cursor:pointer"><input type="checkbox" ${sel.has(v.value) ? 'checked' : ''} onchange="A.toggleControlValue('${layer.id}','${esc(c.field)}','${esc(v.value)}')"><span class="cat-value" title="${v.value}">${v.value}</span><span class="cat-count">${v.count}</span></label>`).join('')}</div>`;
    }
    const step = c.type === 'time' ? Math.max(86400000, Math.round((c.dataMax - c.dataMin) / 200)) : ((c.dataMax - c.dataMin) / 200 || 1);
    if (c.type === 'time') {
        return `<div class="range-info" style="margin-top:6px">≤ <strong id="ctl-${c.field}-v">${fmtCtl(c, c.max)}</strong></div>
            <input type="range" class="rng acc" min="${c.dataMin}" max="${c.dataMax}" step="${step}" value="${c.max}" oninput="A.setControlMax('${layer.id}','${esc(c.field)}', this.value)">
            <button class="btn btn-soft btn-full" style="margin-top:6px" onclick="A.playTime('${layer.id}','${esc(c.field)}')">▶ Animer dans le temps</button>`;
    }
    return `<div class="range-info" style="margin-top:6px"><strong id="ctl-${c.field}-lo">${fmtCtl(c, c.min)}</strong> → <strong id="ctl-${c.field}-hi">${fmtCtl(c, c.max)}</strong></div>
        <input type="range" class="rng" min="${c.dataMin}" max="${c.dataMax}" step="${step}" value="${c.min}" oninput="A.setControlBound('${layer.id}','${esc(c.field)}','min', this.value)">
        <input type="range" class="rng acc" min="${c.dataMin}" max="${c.dataMax}" step="${step}" value="${c.max}" oninput="A.setControlBound('${layer.id}','${esc(c.field)}','max', this.value)">`;
}
function renderControles() {
    $('module-title').textContent = '🎛️ Contrôles';
    const body = $('module-body');
    const layer = STATE.layers.find((l) => l.id === STATE.selectedLayer) || STATE.layers[0];
    if (!layer) { body.innerHTML = `<div class="empty"><div class="ic">🎛️</div><div class="t">Aucune couche</div><div class="h">Importez ou liez des données</div></div>`; return; }
    layer.controls = layer.controls || [];
    const fields = layerFieldNames(layer).map((f) => ({ field: f, type: controlField(layer, f) })).filter((x) => x.type);
    let html = STATE.layers.length > 1
        ? `<select class="input" style="margin-bottom:8px" onchange="A.controlLayer(this.value)">${STATE.layers.map((l) => `<option value="${l.id}" ${l.id === layer.id ? 'selected' : ''}>${l.name}</option>`).join('')}</select>`
        : `<div class="hint">Filtre / anime les objets de <strong>${layer.name}</strong>.</div>`;
    if (!fields.length) { body.innerHTML = html + `<div class="hint">Aucun champ filtrable détecté (date, nombre ou catégorie).</div>`; return; }
    html += fields.map(({ field, type }) => {
        const c = layer.controls.find((x) => x.field === field) || { field, type, active: false };
        const icon = type === 'time' ? '🕑' : type === 'range' ? '📊' : '🏷️';
        return `<div class="section"><div class="toggle-row"><span class="tlabel">${icon} ${field}</span><div class="toggle ${c.active ? 'on' : ''}" onclick="A.toggleControl('${layer.id}','${String(field).replace(/'/g, "\\'")}','${type}')"></div></div>${c.active ? renderControlBody(layer, c) : ''}</div>`;
    }).join('');
    body.innerHTML = html;
}
// ---- Module Récit (storymaps) ----
let _storyIdx = 0;
function renderRecit() {
    $('module-title').textContent = '📖 Récit';
    const body = $('module-body'); const steps = STATE.story || [];
    let html = `<div class="hint">Capture des <strong>étapes</strong> (caméra + couches + filtres + heure) et rejoue-les en présentation.</div>
        <div class="section" style="display:flex;gap:8px">
            <button class="btn btn-primary" style="flex:2" onclick="A.storyCapture()">📸 Capturer l'étape</button>
            ${steps.length ? `<button class="btn btn-dark" style="flex:1" onclick="A.storyPlay(0)">▶ Lecture</button>` : ''}
        </div>`;
    if (!steps.length) { body.innerHTML = html + `<div class="empty"><div class="ic">📖</div><div class="t">Aucune étape</div><div class="h">Cadre la vue puis « Capturer »</div></div>`; return; }
    html += `<div class="layer-list">${steps.map((s, i) => `
        <div class="layer-item">
            <span class="layer-vis on" onclick="A.storyPlay(${i})" title="Aller à l'étape">▶</span>
            <div class="layer-info" style="flex:1">
                <input class="input" style="font-weight:600;padding:4px 6px" value="${(s.title || '').replace(/"/g, '&quot;')}" onchange="A.storySet(${i},'title',this.value)" placeholder="Titre étape ${i + 1}">
                <textarea class="input" style="margin-top:4px;min-height:38px;font-size:12px" onchange="A.storySet(${i},'text',this.value)" placeholder="Texte…">${s.text || ''}</textarea>
            </div>
            <div style="display:flex;flex-direction:column;gap:2px">
                <button class="layer-act" onclick="A.storyMove(${i},-1)" title="Monter">▲</button>
                <button class="layer-act" onclick="A.storyRecapture(${i})" title="Re-capturer la vue">📸</button>
                <button class="layer-act" onclick="A.storyMove(${i},1)" title="Descendre">▼</button>
            </div>
            <button class="layer-del" onclick="A.storyDelete(${i})" title="Supprimer">🗑️</button>
        </div>`).join('')}</div>`;
    body.innerHTML = html;
}
function renderStoryPresentation() {
    const ov = document.getElementById('story-present'); if (!ov) return;
    const s = STATE.story[_storyIdx]; const n = STATE.story.length; if (!s) return;
    ov.innerHTML = `<div style="display:flex;align-items:center;gap:10px">
        <button class="btn btn-soft" onclick="A.storyStep(-1)" ${_storyIdx === 0 ? 'disabled' : ''}>◀</button>
        <div style="flex:1;text-align:center"><div style="font-weight:600;font-size:15px">${s.title || ('Étape ' + (_storyIdx + 1))}</div><div style="font-size:10px;color:#6b6256;letter-spacing:.05em">${_storyIdx + 1} / ${n}</div></div>
        <button class="btn btn-soft" onclick="A.storyStep(1)" ${_storyIdx === n - 1 ? 'disabled' : ''}>▶</button>
        <button class="btn btn-soft" onclick="A.storyExit()" title="Quitter">✕</button>
    </div>${s.text ? `<div style="margin-top:8px;font-size:13px;line-height:1.45">${s.text}</div>` : ''}`;
}
function enterStoryPresentation(i) {
    if (!STATE.story.length) { showToast('Aucune étape à jouer', 'warning'); return; }
    _storyIdx = Math.max(0, Math.min(i || 0, STATE.story.length - 1));
    let ov = document.getElementById('story-present');
    if (!ov) {
        ov = document.createElement('div'); ov.id = 'story-present';
        ov.style.cssText = 'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:1000;background:rgba(244,239,227,0.96);color:#1F1B14;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.25);max-width:520px;width:88%;padding:12px 16px;font-family:\'Hanken Grotesk\',sans-serif';
        (document.getElementById('map-frame') || document.body).appendChild(ov);
    }
    renderStoryPresentation();
    applyStoryState(STATE.story[_storyIdx].state);
}
function symLabelPanel(layer, sym) {
    const l = sym.label;
    return `<div class="section"><div class="toggle-row"><span class="tlabel">Afficher les étiquettes</span><div class="toggle ${l.enabled ? 'on' : ''}" onclick="A.toggleLabel('${layer.id}')"></div></div></div>
        ${l.enabled ? `<div class="section"><div class="section-title">Champ texte</div>${fieldSelect(layer, 'label', l.field, null)}</div>` : ''}`;
}

// ---- Object inspector (selection) ----
function renderObjectInspector() {
    const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId);
    if (!layer) return;
    const count = STATE.selection.features.length;
    const multi = count > 1;
    const idx = STATE.selection.features[multi ? STATE.selection.multiIndex : 0];
    const f = layer.geojson.features[idx];
    const props = f?.properties || {};
    const label = props.name || props._label || props._osmId || `Objet #${idx + 1}`;
    const r = resolveFeatureProps(f, layer);

    $('insp-head').innerHTML = `
        <div class="insp-eyebrow"><span class="layer-swatch" style="background:${layer.color}"></span>${count > 1 ? `${count} objets` : layer.name}</div>
        <div class="insp-title">${count > 1 ? 'Sélection multiple' : label}</div>
        <div class="insp-sub">${count > 1 ? `Édition par lot · ${layer.name}` : `${layer.geometryType}`}</div>`;
    $('insp-tabs').innerHTML = `<button class="insp-tab active">Géométrie</button>`;

    const slider = (id, lbl, val, min, max, step, unit, mixed) => `
        <div class="slider-row">
            <div class="slider-head"><span class="lbl">${lbl}</span><span class="val ${mixed ? 'mixed' : ''}" id="${id}-v">${mixed ? '— mixte —' : val + unit}</span></div>
            <input type="range" class="rng acc" id="${id}" min="${min}" max="${max}" step="${step}" value="${mixed ? (min + max) / 2 : val}" oninput="A.editFeature('${id}', this.value)">
        </div>`;

    if (!multi) {
        const isPt = layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint';
        const modelRow = isPt ? `<div class="slider-row"><div class="slider-head"><span class="lbl">🧩 Modèle 3D</span></div>
            <select class="input" onchange="A.pickFeatureModel(this.value)"><option value="">— cercle 2D —</option>${allModels().map((m) => `<option value="${m.id}" ${r.modelId === m.id ? 'selected' : ''}>${m.icon} ${m.name}</option>`).join('')}</select></div>` : '';
        const importRow = (isPt && layer.kind === 'table' && CONFIG.grist.ready) ? `<button class="btn btn-soft btn-full" style="margin-top:6px" onclick="A.importObjectModel()">📎 Importer un .glb pour cet objet</button>` : '';
        $('insp-body').innerHTML = modelRow + importRow +
            slider('f-scale', '📏 Échelle', r.scale, 0.1, 5, 0.05, '×') +
            slider('f-rotationZ', '🔄 Rotation Z (azimut)', r.rotationZ, 0, 360, 5, '°') +
            slider('f-rotationX', '↕️ Rotation X', r.rotationX, -90, 90, 5, '°') +
            slider('f-offsetZ', '⬆️ Altitude', r.offsetZ, 0, 20, 0.5, 'm') +
            slider('f-offsetX', '↔️ Décalage X', r.offsetX, -10, 10, 0.1, 'm') +
            slider('f-offsetY', '↕️ Décalage Y', r.offsetY, -10, 10, 0.1, 'm');
    } else {
        $('insp-body').innerHTML = `<div class="hint">Modifications relatives appliquées aux ${count} objets.</div>` +
            slider('m-scale', '📏 Échelle (×)', 1, 0.1, 5, 0.05, '×') +
            slider('m-rotationZ', '🔄 Rotation Z (+/-)', 0, -180, 180, 5, '°') +
            slider('m-offsetZ', '⬆️ Altitude (+/-)', 0, -5, 10, 0.5, 'm') +
            slider('m-offsetX', '↔️ Décalage X (+/-)', 0, -5, 5, 0.1, 'm') +
            slider('m-offsetY', '↕️ Décalage Y (+/-)', 0, -5, 5, 0.1, 'm');
    }
    $('insp-foot').innerHTML = `
        <button class="btn btn-soft" style="flex:1" onclick="A.resetSelected()">🔄 Reset</button>
        <button class="btn btn-dark" style="flex:2" onclick="A.applySelected()">Enregistrer · ${count} objet${count > 1 ? 's' : ''}</button>`;
}

// ============================================================
// INTERACTION (clic, hover, sélection, box-select)
// ============================================================
function hitLayerIds() {
    return STATE.layers.filter((l) => map.getLayer(l.id)).map((l) => l.id);
}
function setupInteraction() {
    let boxStart = null, boxEl = null, boxing = false;

    map.on('mousemove', (e) => {
        if (boxing || locationPickMode) return;
        const ids = hitLayerIds();
        const feats = ids.length ? map.queryRenderedFeatures(e.point, { layers: ids }) : [];
        map.getCanvas().style.cursor = feats.length ? (STATE.selection.mode ? 'crosshair' : 'pointer') : (STATE.selection.mode ? 'crosshair' : '');
    });

    map.on('click', (e) => {
        if (boxing) return;
        if (locationPickMode) { onLocationPick(e); return; }
        const ids = hitLayerIds();
        const feats = ids.length ? map.queryRenderedFeatures(e.point, { layers: ids }) : [];
        if (!feats.length) return;
        const f = feats[0];
        const layer = STATE.layers.find((l) => l.id === f.layer.id);
        if (!layer) return;
        const idx = f.properties?._idx ?? 0;
        if (STATE.selection.mode && STATE.selection.layerId === layer.id) {
            if (e.originalEvent.shiftKey) toggleSelect(idx); else STATE.selection.features = [idx];
            afterSelectionChange();
        } else {
            enterSelectionMode(layer.id, idx);
        }
    });

    const cc = map.getCanvasContainer();
    cc.addEventListener('mousedown', (e) => {
        if (!STATE.selection.mode || !e.shiftKey) return;
        map.dragPan.disable(); boxing = true;
        boxStart = { x: e.clientX, y: e.clientY };
        boxEl = document.createElement('div'); boxEl.className = 'selection-box';
        document.body.appendChild(boxEl); e.preventDefault();
    });
    cc.addEventListener('mousemove', (e) => {
        if (!boxing || !boxEl) return;
        const x0 = Math.min(boxStart.x, e.clientX), y0 = Math.min(boxStart.y, e.clientY);
        boxEl.style.left = x0 + 'px'; boxEl.style.top = y0 + 'px';
        boxEl.style.width = Math.abs(e.clientX - boxStart.x) + 'px';
        boxEl.style.height = Math.abs(e.clientY - boxStart.y) + 'px';
    });
    const endBox = (e) => {
        if (!boxing) return;
        map.dragPan.enable();
        const rect = map.getContainer().getBoundingClientRect();
        const a = [Math.min(boxStart.x, e.clientX) - rect.left, Math.min(boxStart.y, e.clientY) - rect.top];
        const b = [Math.max(boxStart.x, e.clientX) - rect.left, Math.max(boxStart.y, e.clientY) - rect.top];
        if (boxEl) { boxEl.remove(); boxEl = null; }
        if (b[0] - a[0] > 4 && b[1] - a[1] > 4) selectInBox(a, b);
        setTimeout(() => { boxing = false; }, 60);
    };
    cc.addEventListener('mouseup', endBox);
    document.addEventListener('mouseup', (e) => { if (boxing) { map.dragPan.enable(); if (boxEl) { boxEl.remove(); boxEl = null; } boxing = false; } });
}

function selectInBox(a, b) {
    const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId);
    if (!layer) return;
    const sw = map.unproject(a), ne = map.unproject(b);
    const minLng = Math.min(sw.lng, ne.lng), maxLng = Math.max(sw.lng, ne.lng);
    const minLat = Math.min(sw.lat, ne.lat), maxLat = Math.max(sw.lat, ne.lat);
    const set = new Set(STATE.selection.features);
    (layer.geojson.features || []).forEach((f, idx) => {
        if (f.geometry?.type !== 'Point') return;
        const [lng, lat] = f.geometry.coordinates;
        if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) set.add(idx);
    });
    STATE.selection.features = [...set];
    afterSelectionChange();
}

async function onLocationPick(e) {
    locationPickMode = false;
    map.getCanvas().style.cursor = '';
    const { lng, lat } = e.lngLat;
    STATE.location = { ...STATE.location, lat, lng, name: `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E` };
    if (STATE.currentModule === 'lieu') renderLieu();
    markDirty();
    showToast('Lieu défini', 'success');
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=16&lat=${lat}&lon=${lng}&accept-language=fr`, { headers: { Accept: 'application/json' } });
        const d = await r.json();
        if (d?.display_name) { STATE.location.name = d.display_name.split(',').slice(0, 2).join(',').trim(); if (STATE.currentModule === 'lieu') renderLieu(); }
    } catch (e2) {}
}
function enterSelectionMode(layerId, idx) {
    STATE.selection.mode = true;
    STATE.selection.layerId = layerId;
    STATE.selection.features = idx != null ? [idx] : [];
    STATE.selection.multiIndex = 0;
    $('map-frame').classList.add('select-mode');
    $('selection-bar').classList.add('open');
    const layer = STATE.layers.find((l) => l.id === layerId);
    showToast(`Mode sélection : ${layer?.name || ''}`, 'info');
    afterSelectionChange();
    if (idx != null) flyToFeature(layer, idx);
}
function exitSelectionMode() {
    const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId);
    if (layer) { saveLayerToGrist(layer, true); }
    STATE.selection = { mode: false, layerId: null, features: [], multiIndex: 0 };
    $('map-frame').classList.remove('select-mode');
    $('selection-bar').classList.remove('open');
    clearHighlight();
    renderInspector();
}
function toggleSelect(idx) {
    const i = STATE.selection.features.indexOf(idx);
    if (i === -1) STATE.selection.features.push(idx); else STATE.selection.features.splice(i, 1);
}
function afterSelectionChange() {
    const n = STATE.selection.features.length;
    $('sel-label').innerHTML = `<strong>${n} objet${n > 1 ? 's' : ''}</strong> sélectionné${n > 1 ? 's' : ''}`;
    if (STATE.selection.multiIndex >= n) STATE.selection.multiIndex = 0;
    $('sel-pos').textContent = n > 1 ? `${STATE.selection.multiIndex + 1} / ${n}` : `${n} / ${n}`;
    multiBaseValues = null;
    updateHighlight();
    renderInspector();
}

function updateHighlight() {
    const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId);
    if (!layer) return;
    const data = { type: 'FeatureCollection', features: STATE.selection.features.map((i) => layer.geojson.features[i]).filter(Boolean) };
    if (!map.getSource('sel-hl')) {
        map.addSource('sel-hl', { type: 'geojson', data });
        map.addLayer({ id: 'sel-hl-ring', type: 'circle', source: 'sel-hl', paint: { 'circle-radius': 16, 'circle-color': 'rgba(196,69,54,0.08)', 'circle-stroke-color': '#C44536', 'circle-stroke-width': 3 } });
    } else map.getSource('sel-hl').setData(data);
}
function clearHighlight() {
    if (map.getLayer('sel-hl-ring')) map.removeLayer('sel-hl-ring');
    if (map.getSource('sel-hl')) map.removeSource('sel-hl');
}
function flyToFeature(layer, idx) {
    const f = layer?.geojson?.features?.[idx];
    if (f?.geometry?.type === 'Point') map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 17), duration: 600 });
}

// Feature editing
let multiBaseValues = null;
function setFeatureOverride(layer, idx, param, value) {
    const f = layer.geojson.features[idx]; if (!f) return;
    if (!f.properties) f.properties = {};
    f.properties['_' + param] = value;
    layer._dirty = true; // éditions non enregistrées → protège de l'auto-refresh
}
function clearFeatureOverrides(layer, idx) {
    const p = layer.geojson.features[idx]?.properties; if (!p) return;
    ['_scale', '_rotationX', '_rotationY', '_rotationZ', '_offsetX', '_offsetY', '_offsetZ', '_modelId'].forEach((k) => delete p[k]);
}
// Write-back des overrides par objet vers la table source (couche kind:'table').
const OVERRIDE_COLS = { _scale: 'scale', _rotationX: 'rotation_x', _rotationY: 'rotation_y', _rotationZ: 'rotation_z', _offsetX: 'offset_x', _offsetY: 'offset_y', _offsetZ: 'offset_z', _modelId: 'model_id' };
async function writeBackFeatures(layer, indices) {
    if (!CONFIG.grist.ready || layer.kind !== 'table' || !layer.sourceTable) return;
    const feats = indices.map((i) => layer.geojson.features[i]).filter((f) => f && f.properties && f.properties._rowId != null);
    if (!feats.length) return;
    const touched = {}; // overrideKey -> colName
    feats.forEach((f) => { for (const k in OVERRIDE_COLS) if (f.properties[k] != null) touched[k] = OVERRIDE_COLS[k]; });
    if (!Object.keys(touched).length) return;
    // ajouter les colonnes de convention manquantes
    const cols = await grist.docApi.fetchTable(layer.sourceTable);
    const existing = new Set(Object.keys(cols));
    const adds = Object.values(touched).filter((c) => !existing.has(c)).map((c) => ['AddColumn', layer.sourceTable, c, { type: c === 'model_id' ? 'Text' : 'Numeric' }]);
    if (adds.length) await grist.docApi.applyUserActions(adds);
    const rowIds = feats.map((f) => f.properties._rowId);
    const colData = {};
    for (const k in touched) colData[touched[k]] = feats.map((f) => (f.properties[k] == null ? null : f.properties[k]));
    await grist.docApi.applyUserActions([['BulkUpdateRecord', layer.sourceTable, rowIds, colData]]);
    // refléter dans les colonnes (cache) pour cohérence à la relecture
    feats.forEach((f) => { for (const k in touched) f.properties[touched[k]] = f.properties[k]; });
}
// Recharge une couche liée depuis sa table source (sans UI) — pour 🔄 et l'auto-refresh.
async function reloadLinkedLayer(l, force) {
    if (!CONFIG.grist.ready || l.kind !== 'table' || !l.sourceTable || !map) return 0;
    if (l._dirty && !force) return -1; // ne pas écraser des éditions non enregistrées
    const cols = await grist.docApi.fetchTable(l.sourceTable);
    const gc = l.geometryColumn || detectGeometryColumn(cols);
    l.geojson = tableToGeoJSON(cols, gc);
    l._perObjectColor = l.geojson.features.some((f) => f.properties && f.properties.fill_color);
    const isPt = l.geometryType === 'Point' || l.geometryType === 'MultiPoint';
    const hasModelCol = l.geojson.features.some((f) => f.properties && (f.properties.model_id || f.properties.model_glb));
    if (isPt && hasModelCol && l.style.mode !== 'library' && l.style.mode !== 'custom') { l.style.mode = 'library'; applyPointStyle(l); }
    indexFeatures(l);
    if (map.getSource(l.id)) map.getSource(l.id).setData(l.geojson); else addLayerToMap(l);
    Models3D.scheduleBuild();
    return l.geojson.features.length;
}
// Auto-refresh des couches liées (au focus / retour sur le widget) — Grist ne pousse
// pas de mises à jour réactives pour les tables non mappées.
let _autoRefreshT = null, _lastAutoRefresh = 0;
function autoRefreshLinked() {
    if (!CONFIG.grist.ready || !STATE.layers.some((l) => l.kind === 'table')) return;
    if (STATE.selection.mode) return; // pas de refresh pendant une édition d'objets
    clearTimeout(_autoRefreshT);
    _autoRefreshT = setTimeout(async () => {
        if (Date.now() - _lastAutoRefresh < 1500) return;
        _lastAutoRefresh = Date.now();
        for (const l of STATE.layers) if (l.kind === 'table') { try { await reloadLinkedLayer(l); } catch (e) {} }
    }, 250);
}
// Entable une couche blob → table Grist standard + re-liaison (convention §5).
// Renvoie le nombre d'objets ; lève en cas d'échec (l'appelant gère le repli blob).
async function entableLayer(layer) {
    const feats = layer.geojson?.features || [];
    if (!feats.length) throw new Error('couche vide');
    const propNames = new Set();
    feats.forEach((f) => Object.keys(f.properties || {}).forEach((k) => { if (!k.startsWith('_') && k !== 'geometry_json') propNames.add(k); }));
    const attrCols = [...propNames];
    const colId = {}; attrCols.forEach((n) => colId[n] = sanitizeId(n));
    const OV = { _scale: 'scale', _rotationX: 'rotation_x', _rotationY: 'rotation_y', _rotationZ: 'rotation_z', _offsetX: 'offset_x', _offsetY: 'offset_y', _offsetZ: 'offset_z' };
    const ovMap = { scale: 'scale', rotation_x: 'rotationX', rotation_y: 'rotationY', rotation_z: 'rotationZ', offset_x: 'offsetX', offset_y: 'offsetY', offset_z: 'offsetZ' };
    const ovUsed = {};
    feats.forEach((f) => { const p = f.properties || {}; for (const k in OV) if (p[k] != null && p[k] !== '') ovUsed[OV[k]] = 1; });
    const is3D = layer.style?.mode === 'library' || layer.style?.mode === 'custom';
    const isPt = layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint';
    const colDefs = [
        { id: 'geometry_json', fields: { label: 'Géométrie (GeoJSON)', type: 'Text' } },
        ...attrCols.map((n) => ({ id: colId[n], fields: { label: n, type: inferGristType(feats.map((f) => f.properties?.[n])) } })),
        ...Object.keys(ovUsed).map((cn) => ({ id: cn, fields: { label: cn, type: 'Numeric' } })),
    ];
    if (is3D) colDefs.push({ id: 'model_id', fields: { label: 'model_id', type: 'Text' } });
    const tableName = sanitizeId('Atlas_' + layer.name);
    const addRes = await grist.docApi.applyUserActions([['AddTable', tableName, colDefs]]);
    const actualTable = addRes?.retValues?.[0]?.table_id || tableName;
    if (isPt) { try { await grist.docApi.applyUserActions([['AddColumn', actualTable, 'model_glb', { type: 'Attachments', label: 'Modèle 3D (PJ)' }]]); } catch (e) {} }
    const BATCH = 200;
    for (let i = 0; i < feats.length; i += BATCH) {
        const batch = feats.slice(i, i + BATCH);
        const colData = { geometry_json: batch.map((f) => JSON.stringify(f.geometry)) };
        attrCols.forEach((n) => { colData[colId[n]] = batch.map((f) => { const v = f.properties?.[n]; return v == null ? null : (typeof v === 'object' ? JSON.stringify(v) : v); }); });
        for (const cn in ovUsed) colData[cn] = batch.map((f) => resolveFeatureProps(f, layer)[ovMap[cn]] ?? null);
        if (is3D) colData.model_id = batch.map((f) => resolveFeatureProps(f, layer).modelId || null);
        await grist.docApi.applyUserActions([['BulkAddRecord', actualTable, Array(batch.length).fill(null), colData]]);
    }
    const cols = await grist.docApi.fetchTable(actualTable);
    layer.geojson = tableToGeoJSON(cols, 'geometry_json');
    layer.kind = 'table'; layer.sourceTable = actualTable; layer.geometryColumn = 'geometry_json'; layer.source = 'grist-table';
    layer._perObjectColor = layer.geojson.features.some((f) => f.properties && f.properties.fill_color);
    indexFeatures(layer); removeLayerGfx(layer); addLayerToMap(layer); Models3D.scheduleBuild();
    saveLayerToGrist(layer, true); markDirty();
    return layer.geojson.features.length;
}

// ============================================================
// IMPORT — OSM (Overpass) & fichier
// ============================================================
function openOSM() {
    $('module-title').textContent = '🌍 Import OSM';
    const b = map.getBounds();
    $('module-body').innerHTML = `
        <div class="hint">Zone importée = emprise visible. Zoomez pour réduire.</div>
        <div class="range-info" style="margin-bottom:12px">${b.getSouth().toFixed(4)}, ${b.getWest().toFixed(4)} → ${b.getNorth().toFixed(4)}, ${b.getEast().toFixed(4)}</div>
        <div class="section"><div class="section-title">Objets prédéfinis</div>
            <div class="model-grid">${Object.entries(OSM_PRESETS).map(([k, p]) => `<div class="model-card" onclick="A.runOSM('${k}')"><div class="mi">${p.icon}</div><div class="mn">${p.name}</div></div>`).join('')}</div>
        </div>
        <div class="section"><button class="btn btn-soft btn-full" onclick="A.openModule('couches')">← Retour</button></div>`;
}
async function runOSM(key) {
    const preset = OSM_PRESETS[key]; if (!preset) return;
    showLoading('Interrogation OpenStreetMap…');
    try {
        const b = map.getBounds();
        const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
        const q = `[out:json][timeout:30];(${preset.query}(${bbox}););out body geom;`;
        const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const geojson = osmToGeoJSON(data.elements || []);
        if (!geojson.features.length) { hideLoading(); showToast('Aucun résultat', 'warning'); return; }
        const geomType = preset.geomType || geojson.features[0].geometry.type;
        const layer = makeLayer(preset.name, geomType, geojson, preset.category, preset.model);
        finalizeNewLayer(layer);
        hideLoading();
        showToast(`${geojson.features.length} objets importés`, 'success');
    } catch (e) { hideLoading(); showToast('Erreur OSM : ' + e.message, 'error'); }
}
function osmToGeoJSON(elements) {
    const features = [];
    for (const el of elements) {
        let geometry = null;
        if (el.type === 'node' && el.lat != null) geometry = { type: 'Point', coordinates: [el.lon, el.lat] };
        else if (el.type === 'way' && el.geometry) {
            const coords = el.geometry.map((p) => [p.lon, p.lat]);
            const closed = coords.length > 3 && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1];
            geometry = (closed && (el.tags?.building || el.tags?.area === 'yes' || el.tags?.landuse)) ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords };
        }
        if (geometry) features.push({ type: 'Feature', geometry, properties: { _osmId: `${el.type}/${el.id}`, ...el.tags } });
    }
    return { type: 'FeatureCollection', features };
}

function makeLayer(name, geomType, geojson, category, modelId) {
    const color = randomColor();
    const is3DPoint = (geomType === 'Point' || geomType === 'MultiPoint') && modelId;
    const layer = {
        id: 'layer-' + Date.now() + '-' + Math.floor(Math.random() * 1e4),
        name, color, visible: true, geometryType: geomType,
        source: 'import', geojson, kind: 'blob',
        _modelCat: category || 'furniture',
        style: {
            mode: is3DPoint ? 'library' : 'mapbox',
            library: { modelId: modelId ? findModel(modelId)?.id : null },
            custom: {},
            common: { scale: modelId ? (findModel(modelId)?.scale || 1) : 1, rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0 },
        },
    };
    initSymbolization(layer);
    return layer;
}
async function finalizeNewLayer(layer) {
    STATE.layers.push(layer);
    addLayerToMap(layer);
    updateRailBadge();
    fitToLayer(layer);
    markDirty();
    if (STATE.currentModule === 'couches') renderLayersPanel(STATE.currentModule);
    else openModule('couches');
    // Auto-entablement : sous Grist, tout import BLOB devient une table standard (donnée
    // de référence). Les couches déjà liées (kind:'table', via 🔗) ne sont pas ré-entablées.
    // Repli blob si pas de Grist ou si l'écriture échoue (jamais de perte).
    if (CONFIG.grist.ready && layer.kind !== 'table') {
        showLoading('Enregistrement dans Grist…');
        try { await entableLayer(layer); }
        catch (e) { console.warn('auto-entable', e.message); saveLayerToGrist(layer, true); showToast('Couche en mode local (entablement Grist échoué)', 'warning'); }
        hideLoading();
        if (STATE.currentModule === 'couches') renderLayersPanel(STATE.currentModule);
    } else {
        saveLayerToGrist(layer, true);
    }
}
function fitToLayer(layer) {
    const bounds = new maplibregl.LngLatBounds();
    let any = false;
    (layer.geojson.features || []).forEach((f) => {
        const g = f.geometry; if (!g) return;
        const coords = g.type === 'Point' ? [g.coordinates] : g.coordinates.flat(g.type.includes('Multi') ? 2 : 1);
        coords.forEach((c) => { if (Array.isArray(c) && typeof c[0] === 'number') { bounds.extend(c); any = true; } });
    });
    if (any) map.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 800 });
}

function wireDrop() {
    const dz = $('drop'); if (!dz) return;
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); };
}
async function processFile(file) {
    showLoading('Lecture du fichier…');
    try {
        const text = await file.text();
        const geojson = JSON.parse(text);
        const features = geojson.features || [geojson];
        const geomType = features[0]?.geometry?.type || 'Point';
        const layer = makeLayer(file.name.replace(/\.[^.]+$/, ''), geomType, { type: 'FeatureCollection', features }, null, null);
        finalizeNewLayer(layer);
        hideLoading();
        showToast(`${features.length} éléments importés`, 'success');
    } catch (e) { hideLoading(); showToast('Erreur : ' + e.message, 'error'); }
}

// ============================================================
// GRIST (persistance — optionnelle, mode standalone OK)
// ============================================================
// ============================================================
// TABLES GÉO LIÉES — convention skills/geo-grist-convention.md
// Lecture d'une table Grist « 1 ligne = 1 objet » comme couche (kind:'table').
// ============================================================
let _linkChoices = [];
const GEOM_COL_ALIASES = ['geometry_json', 'geometry', 'geom', 'wkt'];
const LATLNG_ALIASES = { lat: ['latitude', 'lat', 'y'], lng: ['longitude', 'lng', 'lon', 'x'] };

// Repère la colonne géométrie d'une table colonnaire Grist : renvoie un nom de
// colonne (GeoJSON), ou { lat, lng } si couple de coordonnées.
function detectGeometryColumn(columnar) {
    const keys = Object.keys(columnar || {});
    const find = (n) => keys.find((k) => k.toLowerCase() === n);
    for (const alias of GEOM_COL_ALIASES) { const k = find(alias); if (k) return k; }
    const latK = LATLNG_ALIASES.lat.map(find).find(Boolean);
    const lngK = LATLNG_ALIASES.lng.map(find).find(Boolean);
    if (latK && lngK) return { lat: latK, lng: lngK };
    return null;
}
function parseGeometryValue(columnar, geomCol, i) {
    if (geomCol && geomCol.lat) {
        const la = +columnar[geomCol.lat][i], lo = +columnar[geomCol.lng][i];
        return (isFinite(la) && isFinite(lo)) ? { type: 'Point', coordinates: [lo, la] } : null;
    }
    const v = columnar[geomCol][i];
    if (v == null || v === '') return null;
    if (typeof v === 'object') return v.type ? v : null;
    const s = String(v).trim();
    if (s[0] === '{') { try { const g = JSON.parse(s); return g.type === 'Feature' ? g.geometry : g; } catch (e) { return null; } }
    return null; // WKT non géré en v0 (qgis2grist écrit du GeoJSON)
}
// Table colonnaire Grist → FeatureCollection (id = rowId Grist).
function tableToGeoJSON(columnar, geomCol) {
    const ids = columnar.id || [];
    const isLatLng = !!(geomCol && geomCol.lat);
    const skip = new Set(['id', 'manualSort', isLatLng ? geomCol.lat : geomCol, isLatLng ? geomCol.lng : null].filter(Boolean));
    const propKeys = Object.keys(columnar).filter((k) => !skip.has(k));
    const features = [];
    for (let i = 0; i < ids.length; i++) {
        const geometry = parseGeometryValue(columnar, geomCol, i);
        if (!geometry) continue;
        const properties = { _rowId: ids[i] };
        for (const k of propKeys) properties[k] = columnar[k][i];
        features.push({ type: 'Feature', id: ids[i], geometry, properties });
    }
    return { type: 'FeatureCollection', features };
}
// Scanne le document : tables avec une colonne géométrie (hors registre).
async function scanGeoTables() {
    const out = [];
    if (!CONFIG.grist.ready) return out;
    let tables = [];
    try { tables = await grist.docApi.listTables(); } catch (e) { return out; }
    for (const t of tables) {
        if (t === 'Maquette_Layers') continue;
        try {
            const data = await grist.docApi.fetchTable(t);
            const gc = detectGeometryColumn(data);
            if (!gc) continue;
            const fc = tableToGeoJSON(data, gc);
            if (!fc.features.length) continue;
            out.push({ table: t, geometryColumn: gc, geomType: fc.features[0].geometry.type, count: fc.features.length, _data: data });
        } catch (e) { /* table illisible → ignorée */ }
    }
    return out;
}

// Writer (convention §5, sens descendant) : helpers schéma.
function sanitizeId(s) {
    const v = String(s == null ? '' : s).trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return (/^[a-zA-Z]/.test(v) ? v : '_' + v) || 'Col';
}
function inferGristType(vals) {
    let seen = false, allBool = true, allInt = true, allNum = true;
    for (const v of vals) {
        if (v == null || v === '') continue; seen = true;
        if (typeof v !== 'boolean') allBool = false;
        const n = Number(v);
        const isNum = (typeof v === 'number') || (typeof v === 'string' && v.trim() !== '' && isFinite(n));
        if (!isNum) { allNum = false; allInt = false; }
        else if (!Number.isInteger(n)) allInt = false;
    }
    if (!seen) return 'Text';
    if (allBool) return 'Bool';
    if (allInt) return 'Int';
    if (allNum) return 'Numeric';
    return 'Text';
}

// Jeton d'accès Grist (lecture des pièces jointes via l'API REST) + résolveur d'URL.
let _gristTok = null;
async function ensureGristToken() {
    if (_gristTok && Date.now() < _gristTok.exp) return _gristTok;
    try {
        const t = await grist.docApi.getAccessToken({}); // accès complet (lecture PJ + upload)
        _gristTok = { token: t.token, baseUrl: t.baseUrl, exp: Date.now() + Math.max(10000, (t.ttlMsecs || 60000) - 10000) };
        return _gristTok;
    } catch (e) { return null; }
}
// Upload d'un GLB en pièce jointe (API REST via jeton) → renvoie l'id d'attachment.
async function uploadAttachment(file) {
    const t = await ensureGristToken(); if (!t) throw new Error('jeton Grist indisponible');
    const fd = new FormData(); fd.append('upload', file, file.name);
    const res = await fetch(`${t.baseUrl}/attachments?auth=${encodeURIComponent(t.token)}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ids = await res.json();
    return Array.isArray(ids) ? ids[0] : ids;
}
function attachmentUrlSync(attId) {
    if (!_gristTok || Date.now() >= _gristTok.exp) {
        ensureGristToken().then((t) => { if (t) Models3D.scheduleBuild(); });
        return null;
    }
    return `${_gristTok.baseUrl}/attachments/${attId}/download?auth=${_gristTok.token}`;
}
// id de pièce jointe d'une feature (colonne model_glb, type Attachments Grist).
function featureAttachmentId(f) {
    const v = f.properties && f.properties.model_glb;
    if (v == null || v === '') return null;
    if (Array.isArray(v)) { const ids = v[0] === 'L' ? v.slice(1) : v; return ids.length ? ids[0] : null; }
    if (typeof v === 'number') return v;
    return null;
}

const TABLE_SCHEMAS = {
    Maquette_Layers: [
        { id: 'Name', fields: { label: 'Nom', type: 'Text' } },
        { id: 'Color', fields: { label: 'Couleur', type: 'Text' } },
        { id: 'Visible', fields: { label: 'Visible', type: 'Bool' } },
        { id: 'GeomType', fields: { label: 'Type', type: 'Text' } },
        { id: 'StyleJSON', fields: { label: 'Style (JSON)', type: 'Text' } },
        { id: 'GeoJSON', fields: { label: 'GeoJSON', type: 'Text' } },
    ],
};
async function initGrist() {
    if (typeof grist === 'undefined') { console.log('Grist indisponible — mode standalone'); return; }
    try {
        grist.ready({ requiredAccess: 'full' });
        CONFIG.grist.ready = true;
        await initGristTables();
        await loadLayersFromGrist();
    } catch (e) { console.warn('Grist init:', e.message); }
}
async function initGristTables() {
    const tables = await grist.docApi.listTables();
    if (!tables.includes('Maquette_Layers')) {
        await grist.docApi.applyUserActions([['AddTable', 'Maquette_Layers', TABLE_SCHEMAS.Maquette_Layers]]);
    }
}
async function loadLayersFromGrist() {
    try {
        const rec = await grist.docApi.fetchTable('Maquette_Layers');
        const ids = rec.id || [];
        for (let i = 0; i < ids.length; i++) {
            let geojson, style;
            try { geojson = JSON.parse(rec.GeoJSON[i]); } catch (e) { continue; }
            try { style = JSON.parse(rec.StyleJSON[i]); } catch (e) { style = { mode: 'mapbox' }; }
            const binding = style?._binding; const ctrls = style?._controls; if (style) { delete style._binding; delete style._controls; }
            const layer = {
                id: 'layer-grist-' + ids[i], gristId: ids[i],
                name: rec.Name?.[i] || 'Sans nom', color: rec.Color?.[i] || '#C44536',
                visible: rec.Visible?.[i] !== false, geometryType: rec.GeomType?.[i] || 'Point',
                source: 'grist', geojson, style, _modelCat: 'furniture', kind: binding?.kind || 'blob', controls: ctrls || [],
            };
            if (binding?.kind === 'table') { layer.sourceTable = binding.sourceTable; layer.geometryColumn = binding.geometryColumn; layer._perObjectColor = (geojson.features || []).some((f) => f.properties && f.properties.fill_color); }
            initSymbolization(layer);
            STATE.layers.push(layer);
        }
        updateRailBadge();
        if (STATE.layers.length && map && map.isStyleLoaded()) { STATE.layers.forEach(addLayerToMap); Models3D.rebuildScene(); }
    } catch (e) { console.warn('loadLayers:', e.message); }
}
async function saveLayerToGrist(layer, silent) {
    if (!CONFIG.grist.ready) return;
    try {
        const data = {
            Name: layer.name, Color: layer.color, Visible: layer.visible !== false,
            GeomType: layer.geometryType,
            StyleJSON: JSON.stringify({ ...(layer.style || {}), _binding: layer.kind === 'table' ? { kind: 'table', sourceTable: layer.sourceTable, geometryColumn: layer.geometryColumn } : undefined, _controls: (layer.controls && layer.controls.length) ? layer.controls : undefined }),
            GeoJSON: JSON.stringify(layer.geojson || {}),
        };
        if (layer.gristId) await grist.docApi.applyUserActions([['UpdateRecord', 'Maquette_Layers', layer.gristId, data]]);
        else { const r = await grist.docApi.applyUserActions([['AddRecord', 'Maquette_Layers', null, data]]); layer.gristId = r.retValues[0]; }
        if (!silent) showToast('Couche enregistrée dans Grist', 'success');
    } catch (e) { if (!silent) showToast('Grist : ' + e.message, 'error'); }
}

// ============================================================
// PROJECT SAVE / LOAD (JSON) + autosave
// ============================================================
function buildProject() {
    return { version: '2.0-atlas', savedAt: new Date().toISOString(), projectName: STATE.projectName, location: STATE.location, story: STATE.story, settings: { ...STATE.settings, date: STATE.settings.date.toISOString() }, layers: STATE.layers.map((l) => ({ id: l.id, name: l.name, color: l.color, visible: l.visible, geometryType: l.geometryType, source: l.source, geojson: l.geojson, style: l.style, _modelCat: l._modelCat, kind: l.kind, sourceTable: l.sourceTable, geometryColumn: l.geometryColumn, _perObjectColor: l._perObjectColor, controls: l.controls })) };
}
function saveProject() {
    const json = JSON.stringify(buildProject(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `atlas_${(STATE.projectName || STATE.location.name || 'projet').replace(/[^a-z0-9]/gi, '_')}.json`; a.click();
    URL.revokeObjectURL(url);
    try { localStorage.setItem('atlas_autosave', json); } catch (e) {}
    showToast('Projet enregistré', 'success');
}
async function restoreProject(p) {
    STATE.layers.forEach((l) => removeLayerGfx(l));
    STATE.layers = [];
    STATE.story = p.story || [];
    if (p.projectName) { STATE.projectName = p.projectName; $('project-name').textContent = p.projectName; }
    if (p.location?.lat) { STATE.location = p.location; map.jumpTo({ center: [p.location.lng, p.location.lat] }); }
    if (p.settings) { Object.assign(STATE.settings, p.settings); STATE.settings.date = new Date(p.settings.date || Date.now()); MODEL_LIBRARY.set = STATE.settings.modelSet || 'colored'; }
    (p.layers || []).forEach((ld) => {
        const layer = { ...ld, visible: ld.visible !== false }; initSymbolization(layer); STATE.layers.push(layer); addLayerToMap(layer);
    });
    updateRailBadge(); Models3D.rebuildScene(); applyTerrain(); applyBuildingVisibility(); updateLighting();
    openModule('couches');
    showToast(`Projet chargé · ${p.layers?.length || 0} couches`, 'success');
}
function loadProject() {
    const inp = $('project-input');
    inp.onchange = async (e) => { const file = e.target.files[0]; if (!file) return; try { await restoreProject(JSON.parse(await file.text())); } catch (err) { showToast('Erreur : ' + err.message, 'error'); } inp.value = ''; };
    inp.click();
}
function exportProject() {
    if (!STATE.layers.length) { showToast('Aucune couche à exporter', 'warning'); return; }
    const combined = { type: 'FeatureCollection', features: STATE.layers.flatMap((l) => l.geojson?.features || []) };
    const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'atlas_export.geojson'; a.click(); URL.revokeObjectURL(url);
    showToast('Export GeoJSON', 'success');
}
// ---- Export QGIS : GeoJSON + style QML (réversible avec le parse QML de qgis2grist) ----
function downloadFile(name, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function hexToQgisColor(hex) {
    const h = String(hex || '#999999').replace('#', ''); const r = parseInt(h.slice(0, 2), 16) || 0, g = parseInt(h.slice(2, 4), 16) || 0, b = parseInt(h.slice(4, 6), 16) || 0;
    return `${r},${g},${b},255`;
}
function qgisSymbol(name, geomType, color) {
    const t = geomType.includes('Point') ? 'marker' : geomType.includes('Line') ? 'line' : 'fill';
    const cls = t === 'marker' ? 'SimpleMarker' : t === 'line' ? 'SimpleLine' : 'SimpleFill';
    const props = t === 'marker'
        ? `<prop k="name" v="circle"/><prop k="color" v="${color}"/><prop k="outline_color" v="255,255,255,255"/><prop k="size" v="3"/>`
        : t === 'line'
        ? `<prop k="line_color" v="${color}"/><prop k="line_width" v="0.6"/>`
        : `<prop k="color" v="${color}"/><prop k="outline_color" v="35,35,35,255"/><prop k="outline_width" v="0.26"/>`;
    return `<symbol name="${name}" type="${t}" alpha="1"><layer class="${cls}" enabled="1" pass="0">${props}</layer></symbol>`;
}
function layerToQML(layer) {
    const g = layer.geometryType || 'Point';
    const esc = (s) => String(s).replace(/"/g, '&quot;').replace(/&(?!quot;)/g, '&amp;');
    const sym = layer.style?.symbolization?.color || { mode: 'single', value: layer.color };
    let renderer;
    if (sym.mode === 'categorized' && sym.field && sym.categories?.length) {
        const cats = sym.categories;
        const categories = cats.map((c, i) => `<category value="${esc(c.value)}" label="${esc(c.value)}" symbol="${i}" render="true"/>`).join('');
        const symbols = cats.map((c, i) => qgisSymbol(String(i), g, hexToQgisColor(c.color))).join('');
        renderer = `<renderer-v2 type="categorizedSymbol" attr="${esc(sym.field)}" forceraster="0" symbollevels="0" enableorderby="0"><categories>${categories}</categories><symbols>${symbols}</symbols></renderer-v2>`;
    } else {
        renderer = `<renderer-v2 type="singleSymbol" forceraster="0" symbollevels="0" enableorderby="0"><symbols>${qgisSymbol('0', g, hexToQgisColor(sym.value || layer.color))}</symbols></renderer-v2>`;
    }
    return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>\n<qgis version="3.34" styleCategories="Symbology">\n${renderer}\n</qgis>\n`;
}

// ============================================================
// GEOCODING (Nominatim — libre, sans clé)
// ============================================================
function searchLocation(q) {
    clearTimeout(searchTimer);
    const box = $('loc-results');
    if (q.length < 3) { box.classList.remove('open'); return; }
    searchTimer = setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=fr&q=${encodeURIComponent(q)}`, { headers: { 'Accept': 'application/json' } });
            const data = await res.json();
            box.innerHTML = data.map((d) => `<div class="sr-item" onclick="A.pickSearch('${d.display_name.replace(/'/g, "\\'")}', ${d.lat}, ${d.lon})"><div class="sr-title">${(d.display_name || '').split(',')[0]}</div><div class="sr-sub">${d.display_name}</div></div>`).join('');
            box.classList.toggle('open', data.length > 0);
        } catch (e) { box.classList.remove('open'); }
    }, 350);
}

// ============================================================
// COMMAND PALETTE
// ============================================================
let cmdItems = [], cmdSel = 0;
function openCmd() {
    $('cmd-overlay').classList.add('open');
    $('cmd-input').value = ''; $('cmd-input').focus();
    buildCmdItems('');
}
function closeCmd() { $('cmd-overlay').classList.remove('open'); }
function buildCmdItems(q) {
    const base = [
        { label: 'Lieu', kind: 'module', run: () => openModule('lieu'), ic: '📍' },
        { label: 'Couches', kind: 'module', run: () => openModule('couches'), ic: '🗂️' },
        { label: 'Catalogue 3D / Réglages', kind: 'module', run: () => openModule('reglages'), ic: '⚙️' },
        { label: 'Soleil', kind: 'module', run: () => openModule('soleil'), ic: '☀️' },
        { label: 'Vue & rendu', kind: 'module', run: () => openModule('vues'), ic: '🎯' },
        { label: 'Importer depuis OSM', kind: 'action', run: () => { openModule('couches'); openOSM(); }, ic: '🌍' },
        { label: 'Importer un fichier', kind: 'action', run: () => $('file-input').click(), ic: '📄' },
        { label: 'Enregistrer le projet', kind: 'action', run: saveProject, ic: '💾' },
        { label: 'Exporter en GeoJSON', kind: 'action', run: exportProject, ic: '📤' },
        { label: 'Réinitialiser la vue', kind: 'action', run: () => A.resetView(), ic: '🔄' },
    ];
    STATE.layers.forEach((l) => base.push({ label: l.name, kind: 'couche', run: () => { A.selectLayer(l.id); }, ic: '▢' }));
    const ql = q.toLowerCase();
    cmdItems = base.filter((i) => i.label.toLowerCase().includes(ql));
    cmdSel = 0; renderCmd();
}
function renderCmd() {
    $('cmd-list').innerHTML = cmdItems.map((i, k) => `<div class="cmd-item ${k === cmdSel ? 'sel' : ''}" data-k="${k}"><span class="cmd-ic">${i.ic}</span><span>${i.label}</span><span class="cmd-kind">${i.kind}</span></div>`).join('') || '<div class="cmd-item">Aucun résultat</div>';
    $('cmd-list').querySelectorAll('.cmd-item[data-k]').forEach((el) => el.onclick = () => runCmd(+el.dataset.k));
}
function runCmd(k) { const it = cmdItems[k]; closeCmd(); if (it) it.run(); }

// ============================================================
// UTILS
// ============================================================
function randomColor() { const c = ['#C44536', '#2E4E54', '#5B7A4F', '#E8A234', '#8E5A37', '#6E5A40', '#4292C6', '#af7aa1']; return c[Math.floor(Math.random() * c.length)]; }
function showLoading(t) { $('loading-text').textContent = t || 'Chargement…'; $('loading').classList.add('show'); }
function hideLoading() { $('loading').classList.remove('show'); }
function showToast(msg, type = 'success') {
    const ic = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div'); el.className = 'toast ' + type;
    el.innerHTML = `<span>${ic[type] || ''}</span><span>${msg}</span>`;
    $('toasts').appendChild(el); setTimeout(() => el.remove(), 4000);
}
function updateRailBadge() {
    const b = $('rail-couches-badge'); const n = STATE.layers.length;
    b.style.display = n ? 'block' : 'none'; b.textContent = n;
}
// Petite modale de choix (Promise<key|null>) — pas d'infra modale, on injecte le DOM.
function confirmChoice({ title, message, choices }) {
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(31,27,20,0.4);display:flex;align-items:center;justify-content:center;z-index:5000';
        const box = document.createElement('div');
        box.style.cssText = 'background:#F4EFE3;color:#1F1B14;border-radius:12px;padding:18px;max-width:380px;width:90%;box-shadow:0 12px 40px rgba(0,0,0,0.25);font-family:"Hanken Grotesk",sans-serif';
        box.innerHTML = `<div style="font-weight:600;font-size:15px;margin-bottom:6px">${title}</div><div style="font-size:13px;color:#6b6256;margin-bottom:14px">${message}</div>`;
        const btns = document.createElement('div'); btns.style.cssText = 'display:flex;flex-direction:column;gap:8px';
        const mk = (label, onclick, danger) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'width:100%;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:13px;' + (danger ? 'background:#C44536;color:#fff;border:1px solid #C44536' : 'background:#fff;border:1px solid rgba(0,0,0,0.14)'); b.onclick = onclick; return b; };
        choices.forEach((c) => btns.appendChild(mk(c.label, () => { ov.remove(); resolve(c.key); }, c.kind === 'danger')));
        const cancel = document.createElement('button'); cancel.textContent = 'Annuler'; cancel.style.cssText = 'width:100%;padding:8px;border:none;background:transparent;color:#6b6256;cursor:pointer;font-size:13px;margin-top:2px'; cancel.onclick = () => { ov.remove(); resolve(null); };
        btns.appendChild(cancel); box.appendChild(btns); ov.appendChild(box); document.body.appendChild(ov);
        ov.onclick = (e) => { if (e.target === ov) { ov.remove(); resolve(null); } };
    });
}

// ============================================================
// GLOBAL HANDLER NAMESPACE (inline onclick → A.xxx)
// ============================================================
const A = {
    openModule, exitSelectionMode,

    // Lieu
    recenter() { if (map) map.flyTo({ center: [STATE.location.lng, STATE.location.lat], zoom: 16, pitch: 55, duration: 1200 }); },
    searchLocation,
    pickSearch(name, lat, lng) {
        STATE.location = { ...STATE.location, name, lat: +lat, lng: +lng };
        $('loc-results').classList.remove('open');
        $('project-name').textContent = STATE.projectName || name.split(',')[0];
        map.flyTo({ center: [+lng, +lat], zoom: 16, duration: 1200 });
        markDirty(); renderLieu();
    },
    pickOnMap() {
        locationPickMode = true;
        if (map) map.getCanvas().style.cursor = 'crosshair';
        showToast('Cliquez sur la carte pour définir le lieu (Échap pour annuler)', 'info');
    },
    useGeolocation() {
        if (!navigator.geolocation) { showToast('Géolocalisation non supportée', 'error'); return; }
        showLoading('Localisation…');
        navigator.geolocation.getCurrentPosition((pos) => {
            hideLoading();
            STATE.location = { ...STATE.location, name: 'Ma position', lat: pos.coords.latitude, lng: pos.coords.longitude };
            map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16, duration: 1200 });
            renderLieu(); showToast('Position détectée', 'success');
        }, () => { hideLoading(); showToast('Géolocalisation refusée', 'warning'); }, { timeout: 10000 });
    },
    applyManualCoords() {
        const lat = parseFloat($('loc-lat').value), lng = parseFloat($('loc-lng').value);
        if (isNaN(lat) || isNaN(lng)) { showToast('Coordonnées invalides', 'warning'); return; }
        STATE.location = { ...STATE.location, lat, lng, name: `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E` };
        map.flyTo({ center: [lng, lat], zoom: 16, duration: 1000 }); renderLieu();
    },
    setRadius(r) { STATE.location.radius = r; renderLieu(); },
    setProjectName(v) { STATE.projectName = v; $('project-name').textContent = v || 'Nouveau projet'; markDirty(); },

    // Couches
    openOSM, runOSM,
    async openLinkTable() {
        if (!CONFIG.grist.ready) { showToast('Disponible seulement dans Grist', 'warning'); return; }
        showLoading('Recherche des tables géo…');
        _linkChoices = await scanGeoTables();
        hideLoading();
        const body = $('module-body');
        const back = `<div class="section"><button class="btn btn-soft btn-full" onclick="A.openModule('couches')">← Retour</button></div>`;
        if (!_linkChoices.length) {
            body.innerHTML = `<div class="empty"><div class="ic">🔍</div><div class="t">Aucune table géo trouvée</div><div class="h">Importez d'abord via QGIS → Grist</div></div>${back}`;
            return;
        }
        const already = new Set(STATE.layers.filter((l) => l.kind === 'table').map((l) => l.sourceTable));
        body.innerHTML = `<div class="section-title">Tables géo détectées</div><div class="layer-list">${_linkChoices.map((g, i) => `
            <div class="layer-item" onclick="A.linkTableChoice(${i})">
                <div class="layer-info"><div class="layer-name">${g.table}${already.has(g.table) ? ' ✓' : ''}</div>
                <div class="layer-meta"><span>${g.count} obj.</span><span class="badge3d">${g.geomType}</span></div></div>
                <button class="layer-act" title="Lier comme couche">🔗</button>
            </div>`).join('')}</div>${back}`;
    },
    linkTableChoice(i) { const g = _linkChoices[i]; if (g) this.linkTable(g.table, g.geometryColumn, g._data); },
    showGeoTable(t) { const g = _geoTables.find((x) => x.table === t); if (g) this.linkTable(g.table, g.geometryColumn, g._data); else this.linkTable(t); },
    async linkTable(tableId, geomCol, data) {
        if (!CONFIG.grist.ready) { showToast('Grist requis', 'warning'); return; }
        showLoading('Lecture de la table…');
        try {
            const cols = data || await grist.docApi.fetchTable(tableId);
            const gc = geomCol || detectGeometryColumn(cols);
            if (!gc) { hideLoading(); showToast('Aucune colonne géométrie', 'error'); return; }
            const fc = tableToGeoJSON(cols, gc);
            if (!fc.features.length) { hideLoading(); showToast('Table sans géométrie exploitable', 'warning'); return; }
            const layer = makeLayer(tableId, fc.features[0].geometry.type, fc, null, null);
            const isPoint = layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint';
            const hasModelCol = fc.features.some((f) => f.properties && (f.properties.model_id || f.properties.model_glb));
            if (isPoint && hasModelCol) layer.style.mode = 'library'; // modèle 3D par objet (colonne model_id)
            layer.kind = 'table'; layer.sourceTable = tableId; layer.geometryColumn = gc; layer.source = 'grist-table';
            layer._perObjectColor = fc.features.some((f) => f.properties && f.properties.fill_color);
            finalizeNewLayer(layer);
            hideLoading();
            showToast(`« ${tableId} » liée · ${fc.features.length} objets`, 'success');
        } catch (e) { hideLoading(); showToast('Erreur : ' + e.message, 'error'); }
    },
    async explodeToTable(id, e) {
        if (e) e.stopPropagation();
        if (!CONFIG.grist.ready) { showToast('Grist requis pour exploser en table', 'warning'); return; }
        const layer = STATE.layers.find((x) => x.id === id); if (!layer) return;
        if (layer.kind === 'table') { showToast('Couche déjà liée à une table', 'info'); return; }
        const feats = layer.geojson?.features || [];
        if (!feats.length) { showToast('Couche vide', 'warning'); return; }
        showLoading('Création de la table…');
        try {
            const n = await entableLayer(layer);
            hideLoading(); showToast(`Table créée · ${n} objets`, 'success');
            if (STATE.currentModule === 'couches') renderLayersPanel(STATE.currentModule);
        } catch (err) { hideLoading(); showToast('Erreur : ' + err.message, 'error'); }
    },
    async refreshLayer(id, e) {
        if (e) e.stopPropagation();
        const l = STATE.layers.find((x) => x.id === id); if (!l || l.kind !== 'table') return;
        showLoading('Rafraîchissement…');
        try {
            l._dirty = false; const n = await reloadLinkedLayer(l, true);
            hideLoading(); showToast(`Rafraîchie · ${n} objets`, 'success');
            if (STATE.currentModule === 'couches') renderLayersPanel(STATE.currentModule);
        } catch (e2) { hideLoading(); showToast('Erreur : ' + e2.message, 'error'); }
    },
    selectLayer(id) {
        STATE.selectedLayer = id;
        const layer = STATE.layers.find((l) => l.id === id);
        if (layer) layer._modelCat = layer._modelCat || 'furniture';
        if (STATE.currentModule !== 'couches') openModule('couches');
        else { renderLayersPanel('couches'); renderInspector(); }
    },
    toggleLayer(id, e) { e.stopPropagation(); const l = STATE.layers.find((x) => x.id === id); if (!l) return; setLayerVisibility(l, l.visible === false); renderLayersPanel(STATE.currentModule); updateLegend(); },
    toggleAllLayers(v) { STATE.layers.forEach((l) => setLayerVisibility(l, v)); renderLayersPanel(STATE.currentModule); updateLegend(); },
    zoomLayer(id, e) {
        if (e) e.stopPropagation();
        const l = STATE.layers.find((x) => x.id === id);
        if (!l?.geojson?.features?.length) { showToast('Couche vide', 'warning'); return; }
        if (l.visible === false) setLayerVisibility(l, true);
        fitToLayer(l);
        showToast(`Zoom sur « ${l.name} »`, 'info');
    },
    async deleteLayer(id, e) {
        if (e) e.stopPropagation();
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        let dropTable = false;
        if (l.kind === 'table' && CONFIG.grist.ready && l.sourceTable) {
            const choice = await confirmChoice({
                title: `Supprimer « ${l.name} »`,
                message: `Couche liée à la table Grist « ${l.sourceTable} ». La retirer d'Atlas (la table reste, ré-importable via 🔗) ou supprimer aussi la table ?`,
                choices: [
                    { key: 'atlas', label: "Retirer d'Atlas (garder la table)" },
                    { key: 'grist', label: 'Supprimer aussi la table de Grist', kind: 'danger' },
                ],
            });
            if (!choice) return;
            dropTable = choice === 'grist';
        } else if (!confirm(`Supprimer la couche « ${l.name} » ?`)) return;
        removeLayerGfx(l);
        if (CONFIG.grist.ready && l.gristId) grist.docApi.applyUserActions([['RemoveRecord', 'Maquette_Layers', l.gristId]]).catch(() => {});
        if (dropTable && l.sourceTable) grist.docApi.applyUserActions([['RemoveTable', l.sourceTable]]).catch((e2) => showToast('Table non supprimée : ' + e2.message, 'warning'));
        STATE.layers = STATE.layers.filter((x) => x.id !== id);
        if (STATE.selectedLayer === id) STATE.selectedLayer = null;
        updateRailBadge(); Models3D.rebuildScene(); renderLayersPanel(STATE.currentModule); renderInspector(); updateLegend();
        showToast(dropTable ? 'Couche et table supprimées' : (l.kind === 'table' ? "Couche retirée d'Atlas" : 'Couche supprimée'), 'success');
    },
    saveLayer(id) { const l = STATE.layers.find((x) => x.id === id); if (l) saveLayerToGrist(l); markDirty(); },

    // Modèles
    setModelCat(id, cat) { const l = STATE.layers.find((x) => x.id === id); if (l) { l._modelCat = cat; renderInspector(); } },
    // Représentation de la couche : 'mapbox' (cercle 2D) ou 'library' (modèle 3D)
    setRepresentation(id, mode) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        l.style.mode = mode;
        if (mode === 'library' && !l.style.library?.modelId) {
            const cat = l._modelCat || 'lighting';
            const first = MODEL_LIBRARY.categories[cat].models[0];
            l.style.library = { modelId: first.id };
            l.style.common = { ...(l.style.common || {}), scale: first.scale || 1 };
        }
        applyPointStyle(l); Models3D.forceBuild(); renderInspector(); markDirty();
    },
    openLayerModel(id) { STATE.selectedLayer = id; inspSymTab = 'Modèle 3D'; openModule('couches'); },
    editLayerObjects(id) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        enterSelectionMode(id);
        showToast('Cliquez un objet à éditer · Maj+glisser = zone · ✓ Tout = toute la couche', 'info');
    },
    setModelSet(set) {
        MODEL_LIBRARY.set = set; STATE.settings.modelSet = set;
        Models3D.gltfCache.clear(); Models3D.protoCache.clear(); // recharger les GLB du nouveau set
        Models3D.forceBuild(); renderModelsPanel(); markDirty();
    },
    setModelBase(url) {
        url = (url || '').trim().replace(/\/+$/, '') + '/';
        MODEL_LIBRARY.baseRoot = url; MODEL_BASE_EXPLICIT = true;
        try { localStorage.setItem('atlas_model_base', url); } catch (e) {}
        Models3D.gltfCache.clear(); Models3D.protoCache.clear(); Models3D.forceBuild();
        renderModelsPanel(); showToast('Source modèles définie', 'success');
    },
    async testModelBase() {
        const base = ((document.getElementById('model-src-input')?.value || MODEL_LIBRARY.baseRoot).trim().replace(/\/+$/, '')) + '/';
        const el = document.getElementById('model-src-info');
        if (el) { el.textContent = '… test ' + base; el.style.color = 'var(--muted)'; }
        try {
            const r = await fetch(base + 'catalog.json', { cache: 'no-store' });
            if (r.ok) { const c = await r.json(); if (el) { el.textContent = `✅ OK — ${c.models?.length || 0} modèles · ${base}`; el.style.color = 'var(--green)'; } }
            else if (el) { el.textContent = `❌ HTTP ${r.status} · ${base}`; el.style.color = 'var(--accent)'; }
        } catch (e) { if (el) { el.textContent = `❌ ${e.message} · ${base}`; el.style.color = 'var(--accent)'; } }
    },
    pickModel(id, modelId) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        l.style.mode = 'library'; l.style.library = { modelId };
        // remplace réellement : repasse en modèle unique et purge le mode catégorisé
        // + les overrides _modelId par objet (sinon d'anciens modèles « restent »)
        const sym = initSymbolization(l);
        sym.model.mode = 'single'; sym.model.field = null; sym.model.categories = []; sym.model.defaultModelId = null;
        (l.geojson?.features || []).forEach((f) => { if (f.properties) delete f.properties._modelId; });
        const m = findModel(modelId);
        l.style.common = { ...(l.style.common || {}), scale: m?.scale || 1, rotationX: 0, rotationY: 0, rotationZ: 0, offsetX: 0, offsetY: 0, offsetZ: 0 };
        applyLayerStyle(l); Models3D.forceBuild(); renderInspector(); markDirty();
        showToast(`Modèle « ${m?.name} » appliqué`, 'success');
    },

    // Soleil
    timePreset(p) {
        const c = map.getCenter();
        let min = 720;
        if (typeof SunCalc !== 'undefined') {
            try {
                const t = SunCalc.getTimes(STATE.settings.date, c.lat, c.lng);
                const mm = (d) => d && !isNaN(d.getTime()) ? d.getHours() * 60 + d.getMinutes() : 720;
                if (p === 'dawn') min = mm(t.sunrise);
                else if (p === 'day') min = mm(t.solarNoon);
                else if (p === 'dusk') min = mm(t.sunset);
                else min = (mm(t.sunset) + 90) % 1440;
            } catch (e) {}
        } else min = { dawn: 390, day: 750, dusk: 1110, night: 1380 }[p];
        STATE.settings.timeOfDay = min; updateLighting(); renderSoleil();
    },
    setTime(v) { STATE.settings.timeOfDay = +v; updateLighting(); const h = Math.floor(v / 60), m = v % 60; const el = document.querySelector('#module-body .val'); if (el && STATE.currentModule === 'soleil') el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; },
    setSunDate(v) { STATE.settings.date = new Date(v + 'T12:00:00'); updateLighting(); renderSoleil(); },
    toggleSetting(key) {
        STATE.settings[key] = !STATE.settings[key];
        if (key === 'buildings3D') applyBuildingVisibility();
        else if (key === 'terrain3D') { applyTerrain(); setTimeout(() => Models3D.recomputeAll(), 250); }
        else if (key === 'labels') applyLabelsVisibility();
        else if (key === 'sky') applySky();
        else if (key === 'shadows') { updateLighting(); $('shadow-toggle').classList.toggle('on', STATE.settings.shadows); }
        if (STATE.currentModule === 'vues') renderVues(); else if (STATE.currentModule === 'soleil') renderSoleil();
    },

    // Vue
    viewPreset(p) {
        const presets = { top: { pitch: 0, bearing: 0, zoom: 17 }, '3d': { pitch: 55, bearing: -18, zoom: 16 }, street: { pitch: 78, bearing: 0, zoom: 18 } };
        map.easeTo({ ...presets[p], duration: 1000 });
    },
    setPitch(v) { map.setPitch(+v); $('v-pitch').textContent = Math.round(v) + '°'; },
    setBearing(v) { map.setBearing(+v); $('v-bearing').textContent = Math.round(v) + '°'; },
    setExag(v) { STATE.settings.terrainExaggeration = +v; $('v-exag').textContent = v + '×'; if (STATE.settings.terrain3D) { applyTerrain(); clearTimeout(this._exagT); this._exagT = setTimeout(() => Models3D.recomputeAll(), 200); } },
    setBasemap(k) {
        STATE.settings.basemap = k; renderVues();
        const b = BASEMAPS[k];
        // Couper le relief AVANT de changer de style : pendant la transition la
        // source DEM est retirée mais le terrain y pointe encore → la passe de
        // profondeur du terrain plante (shaderPreludeCode). onStyleReady le ré-applique.
        try { map.setTerrain(null); } catch (e) {}
        map.setStyle(b.style ? b.style() : b.url);
        map.once('idle', onStyleReady);
    },
    setTerrainSource(src) { setTerrainSource(src); renderVues(); },
    setProjection(p) { STATE.settings.projection = p; applyProjection(); renderVues(); },
    resetView() { map.easeTo({ center: [STATE.location.lng, STATE.location.lat], zoom: 16, pitch: 55, bearing: -18, duration: 1000 }); },

    // Symbology
    setSymTab(t) { inspSymTab = t; renderInspector(); },
    setSymMode(id, param, mode) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        const sym = initSymbolization(l); sym[param].mode = mode;
        if (mode === 'graduated' && sym[param].field) { const r = getNumericRange(l, sym[param].field); if (r.count) sym[param].inputRange = [r.min, r.max]; }
        if (mode === 'categorized' && sym[param].field) regenCategories(l, param);
        applyLayerStyle(l); renderInspector();
    },
    setSymField(id, param, field) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        const sym = initSymbolization(l); sym[param].field = field || null;
        if (field && param === 'color' && sym.color.mode === 'categorized') regenCategories(l, 'color');
        if (field && param === 'model' && sym.model.mode === 'categorized') sym.model.categories = [];
        applyLayerStyle(l); renderInspector();
    },
    setSymMethod(id, param, method) { const l = STATE.layers.find((x) => x.id === id); if (!l) return; initSymbolization(l)[param].method = method; applyLayerStyle(l); renderInspector(); },
    setSymPalette(id, param, palette) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        const sym = initSymbolization(l); sym[param].palette = palette; if (param === 'color') sym.color.colorRamp = palette;
        if (sym[param].categories) regenCategories(l, param);
        applyLayerStyle(l); renderInspector();
    },
    setSymColorValue(id, v) { const l = STATE.layers.find((x) => x.id === id); if (!l) return; initSymbolization(l).color.value = v; l.color = v; applyLayerStyle(l); renderInspector(); updateLegend(); },
    setSymSizeValue(id, v) { const l = STATE.layers.find((x) => x.id === id); if (!l) return; initSymbolization(l).size.value = +v; const el = $('sz-val'); if (el) el.textContent = v + (l.geometryType === 'Polygon' ? ' m' : (l.style?.mode === 'library' ? ' ×' : ' px')); applyLayerStyle(l); },
    setSymOutput(id, param, i, v) { const l = STATE.layers.find((x) => x.id === id); if (!l) return; initSymbolization(l)[param].outputRange[i] = +v; applyLayerStyle(l); },
    pickCatColor(id, value, el) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        const cat = l.style.symbolization.color.categories.find((c) => String(c.value) === String(value)); if (!cat) return;
        const inp = document.createElement('input'); inp.type = 'color'; inp.value = cat.color; inp.style.position = 'fixed'; inp.style.opacity = '0';
        document.body.appendChild(inp);
        inp.oninput = () => { cat.color = inp.value; el.style.background = inp.value; applyLayerStyle(l); };
        inp.onchange = () => inp.remove();
        inp.click();
    },
    setModelCategory(id, value, modelId) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        const sym = initSymbolization(l); let cat = sym.model.categories.find((c) => String(c.value) === String(value));
        if (!cat) { cat = { value }; sym.model.categories.push(cat); }
        cat.modelId = modelId || null; applyLayerStyle(l); Models3D.forceBuild(); renderInspector();
    },
    setDefaultModel(id, modelId) { const l = STATE.layers.find((x) => x.id === id); if (!l) return; initSymbolization(l).model.defaultModelId = modelId || null; applyLayerStyle(l); Models3D.forceBuild(); },
    setCommon(id, param, v, elId, unit) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        l.style.common = l.style.common || {}; l.style.common[param] = +v;
        const el = $(elId); if (el) el.textContent = v + (unit || '');
        Models3D.updateEdited(id, (l.geojson?.features || []).map((_, i) => i));
    },
    setOrientationField(id, field) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        initSymbolization(l).orientation = { field: field || null };
        Models3D.forceBuild(); markDirty(); renderInspector();
    },
    // ---- Contrôles (filtres/animation) ----
    controlLayer(id) { STATE.selectedLayer = id; renderControles(); },
    toggleControl(id, field, type) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return; l.controls = l.controls || [];
        let c = l.controls.find((x) => x.field === field);
        if (!c) { c = { field, type }; Object.assign(c, controlBounds(l, type, field)); if (type !== 'select') { c.min = c.dataMin; c.max = c.dataMax; } l.controls.push(c); }
        c.active = !c.active;
        applyControls(l); renderControles(); markDirty();
    },
    setControlBound(id, field, which, v) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return; const c = (l.controls || []).find((x) => x.field === field); if (!c) return;
        c[which] = +v; if (c.min > c.max) { if (which === 'min') c.max = c.min; else c.min = c.max; }
        const el = $(`ctl-${field}-${which === 'min' ? 'lo' : 'hi'}`); if (el) el.textContent = fmtCtl(c, c[which]);
        clearTimeout(this._ctlT); this._ctlT = setTimeout(() => applyControls(l), 80); markDirty();
    },
    setControlMax(id, field, v) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return; const c = (l.controls || []).find((x) => x.field === field); if (!c) return;
        c.max = +v; const el = $(`ctl-${field}-v`); if (el) el.textContent = fmtCtl(c, c.max);
        clearTimeout(this._ctlT); this._ctlT = setTimeout(() => applyControls(l), 80); markDirty();
    },
    toggleControlValue(id, field, value) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return; const c = (l.controls || []).find((x) => x.field === field); if (!c) return;
        c.values = c.values || []; const i = c.values.indexOf(value); if (i >= 0) c.values.splice(i, 1); else c.values.push(value);
        applyControls(l); markDirty();
    },
    playTime(id, field) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return; const c = (l.controls || []).find((x) => x.field === field); if (!c || c.type !== 'time') return;
        if (this._playT) { clearInterval(this._playT); this._playT = null; return; }
        c.max = c.dataMin; const steps = 60, inc = (c.dataMax - c.dataMin) / steps;
        this._playT = setInterval(() => {
            c.max += inc; if (c.max >= c.dataMax) { c.max = c.dataMax; clearInterval(this._playT); this._playT = null; }
            applyControls(l); const el = $(`ctl-${field}-v`); if (el) el.textContent = fmtCtl(c, c.max);
        }, 66);
    },
    // ---- Récit (storymaps) ----
    storyCapture() { STATE.story.push({ title: 'Étape ' + (STATE.story.length + 1), text: '', state: captureStoryState() }); markDirty(); saveStoryToGrist(); renderRecit(); showToast('Étape capturée', 'success'); },
    storyRecapture(i) { if (STATE.story[i]) { STATE.story[i].state = captureStoryState(); markDirty(); saveStoryToGrist(); showToast('Vue mise à jour', 'success'); } },
    storySet(i, k, v) { if (STATE.story[i]) { STATE.story[i][k] = v; markDirty(); saveStoryToGrist(); } },
    storyMove(i, d) { const j = i + d; if (j < 0 || j >= STATE.story.length) return; const a = STATE.story; [a[i], a[j]] = [a[j], a[i]]; markDirty(); saveStoryToGrist(); renderRecit(); },
    storyDelete(i) { STATE.story.splice(i, 1); markDirty(); saveStoryToGrist(); renderRecit(); },
    storyPlay(i) { enterStoryPresentation(i); },
    storyStep(d) { _storyIdx = Math.max(0, Math.min(_storyIdx + d, STATE.story.length - 1)); renderStoryPresentation(); applyStoryState(STATE.story[_storyIdx].state); },
    storyExit() { const ov = document.getElementById('story-present'); if (ov) ov.remove(); },
    toggleLabel(id) { const l = STATE.layers.find((x) => x.id === id); if (!l) return; const lab = initSymbolization(l).label; lab.enabled = !lab.enabled; applyLayerStyle(l); renderInspector(); },
    resetSymbology(id) {
        const l = STATE.layers.find((x) => x.id === id); if (!l) return;
        delete l.style.symbolization; initSymbolization(l); applyLayerStyle(l); renderInspector(); showToast('Symbologie réinitialisée', 'success');
    },

    // Selection editing
    selPrev() { nav(-1); }, selNext() { nav(1); },
    selAll() {
        const l = STATE.layers.find((x) => x.id === STATE.selection.layerId); if (!l) return;
        STATE.selection.features = l.geojson.features.map((_, i) => i); afterSelectionChange();
    },
    selClear() { STATE.selection.features = []; afterSelectionChange(); },
    editFeature(sliderId, value) {
        const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId); if (!layer) return;
        const v = parseFloat(value); const el = $(sliderId + '-v');
        const param = sliderId.split('-')[1];
        const multi = sliderId.startsWith('m-');
        const unit = param === 'scale' ? '×' : param.startsWith('offset') ? 'm' : '°';
        if (el) el.textContent = (multi && v >= 0 && param !== 'scale' ? '+' : '') + (param === 'scale' ? v.toFixed(2) : v) + unit;
        if (!multi) {
            const idx = STATE.selection.features[0];
            setFeatureOverride(layer, idx, param, v);
        } else {
            if (!multiBaseValues) {
                multiBaseValues = {};
                STATE.selection.features.forEach((i) => { multiBaseValues[i] = resolveFeatureProps(layer.geojson.features[i], layer); });
            }
            STATE.selection.features.forEach((i) => {
                const base = multiBaseValues[i] || {};
                if (param === 'scale') setFeatureOverride(layer, i, 'scale', (base.scale || 1) * v);
                else if (param === 'rotationZ') setFeatureOverride(layer, i, 'rotationZ', ((base.rotationZ || 0) + v + 360) % 360);
                else setFeatureOverride(layer, i, param, (base[param] || 0) + v);
            });
        }
        Models3D.updateEdited(layer.id, multi ? STATE.selection.features : [STATE.selection.features[0]]);
    },
    importObjectModel() {
        const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId);
        if (!layer) return;
        if (layer.kind !== 'table' || !CONFIG.grist.ready) { showToast('Importer un .glb nécessite une couche liée à une table Grist', 'warning'); return; }
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.glb,model/gltf-binary';
        inp.onchange = async () => {
            const file = inp.files && inp.files[0]; if (!file) return;
            showLoading('Import du modèle 3D…');
            try {
                const id = await uploadAttachment(file);
                if (id == null) throw new Error('upload sans id');
                const cols = await grist.docApi.fetchTable(layer.sourceTable);
                if (!('model_glb' in cols)) await grist.docApi.applyUserActions([['AddColumn', layer.sourceTable, 'model_glb', { type: 'Attachments' }]]);
                const feats = STATE.selection.features.map((i) => layer.geojson.features[i]).filter((f) => f && f.properties && f.properties._rowId != null);
                if (!feats.length) throw new Error('aucun objet sélectionné');
                await grist.docApi.applyUserActions([['BulkUpdateRecord', layer.sourceTable, feats.map((f) => f.properties._rowId), { model_glb: feats.map(() => ['L', id]) }]]);
                feats.forEach((f) => { f.properties.model_glb = ['L', id]; });
                const isPt = layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint';
                if (isPt && layer.style.mode !== 'library' && layer.style.mode !== 'custom') { layer.style.mode = 'library'; applyPointStyle(layer); }
                Models3D.forceBuild(); markDirty();
                hideLoading(); showToast(`Modèle importé · ${feats.length} objet(s)`, 'success');
            } catch (e) {
                hideLoading();
                // Upload souvent bloqué par la politique CORS de l'instance Grist.
                const cors = /fetch|CORS|Failed|NetworkError|load failed/i.test(e.message || '');
                showToast(cors ? 'Upload bloqué par Grist (CORS). Attache le .glb dans la colonne « Modèle 3D (PJ) » de la table, puis 🔄.' : 'Import : ' + e.message, 'error');
            }
        };
        inp.click();
    },
    pickFeatureModel(modelId) {
        const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId); if (!layer) return;
        const idx = STATE.selection.features[0];
        setFeatureOverride(layer, idx, 'modelId', modelId || null);
        const isPt = layer.geometryType === 'Point' || layer.geometryType === 'MultiPoint';
        if (modelId && isPt && layer.style.mode !== 'library' && layer.style.mode !== 'custom') { layer.style.mode = 'library'; applyPointStyle(layer); }
        Models3D.forceBuild(); markDirty(); renderInspector();
    },
    resetSelected() {
        const l = STATE.layers.find((x) => x.id === STATE.selection.layerId); if (!l) return;
        STATE.selection.features.forEach((i) => clearFeatureOverrides(l, i));
        l._dirty = false;
        multiBaseValues = null; Models3D.updateEdited(l.id, STATE.selection.features); renderInspector(); showToast('Réinitialisé', 'success');
    },
    async applySelected() {
        const l = STATE.layers.find((x) => x.id === STATE.selection.layerId);
        multiBaseValues = null; markDirty();
        if (l && l.kind === 'table' && CONFIG.grist.ready) {
            try { await writeBackFeatures(l, STATE.selection.features); } catch (e) { showToast('Écriture Grist : ' + e.message, 'error'); return; }
        } else if (l) { saveLayerToGrist(l, true); }
        if (l) l._dirty = false; // édition enregistrée
        showToast(`${STATE.selection.features.length} objet(s) enregistré(s)`, 'success');
    },

    // Project
    saveProject, loadProject, exportProject,
    exportLayerQGIS(id, e) {
        if (e) e.stopPropagation();
        const l = STATE.layers.find((x) => x.id === id);
        if (!l || !l.geojson?.features?.length) { showToast('Couche vide', 'warning'); return; }
        const base = sanitizeId(l.name) || 'couche';
        const fc = { type: 'FeatureCollection', features: l.geojson.features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: Object.fromEntries(Object.entries(f.properties || {}).filter(([k]) => !k.startsWith('_') && k !== 'geometry_json')) })) };
        downloadFile(base + '.geojson', JSON.stringify(fc), 'application/geo+json');
        setTimeout(() => downloadFile(base + '.qml', layerToQML(l), 'application/xml'), 350);
        showToast(`Export QGIS : ${base}.geojson + .qml`, 'success');
    },
};
function regenCategories(layer, param) {
    const sym = layer.style.symbolization[param];
    const vals = getUniqueValues(layer, sym.field, 100);
    if (param === 'color') sym.categories = vals.map((v, i) => ({ value: v.value, color: paletteColor(sym.palette, i, vals.length), count: v.count }));
}
function nav(dir) {
    const layer = STATE.layers.find((l) => l.id === STATE.selection.layerId); if (!layer) return;
    const n = STATE.selection.features.length;
    if (n > 1) {
        STATE.selection.multiIndex = (STATE.selection.multiIndex + dir + n) % n;
        flyToFeature(layer, STATE.selection.features[STATE.selection.multiIndex]);
        $('sel-pos').textContent = `${STATE.selection.multiIndex + 1} / ${n}`;
        renderObjectInspector();
    } else {
        const total = layer.geojson.features.length;
        const cur = STATE.selection.features[0] ?? 0;
        const next = (cur + dir + total) % total;
        STATE.selection.features = [next];
        flyToFeature(layer, next); afterSelectionChange();
    }
}
window.A = A;

// ============================================================
// EVENT WIRING
// ============================================================
function wireEvents() {
    document.querySelectorAll('.rail-item[data-module]').forEach((b) => {
        b.addEventListener('click', () => {
            const m = b.dataset.module;
            if (STATE.currentModule === m) closeModulePanel(); else openModule(m);
        });
    });
    $('btn-save').addEventListener('click', saveProject);
    $('btn-load').addEventListener('click', loadProject);
    $('btn-export').addEventListener('click', exportProject);
    $('cmdk-trigger').addEventListener('click', openCmd);
    $('compass').addEventListener('click', () => map.easeTo({ bearing: 0, duration: 600 }));

    $('file-input').addEventListener('change', (e) => { if (e.target.files[0]) processFile(e.target.files[0]); e.target.value = ''; });

    // legend collapse
    $('legend-head').addEventListener('click', () => $('legend').classList.toggle('collapsed'));

    // selection bar
    $('sel-prev').addEventListener('click', () => A.selPrev());
    $('sel-next').addEventListener('click', () => A.selNext());
    $('sel-all').addEventListener('click', () => A.selAll());
    $('sel-clear').addEventListener('click', () => A.selClear());
    $('sel-exit').addEventListener('click', exitSelectionMode);

    // shadow toggle on sun strip
    $('shadow-toggle').addEventListener('click', () => A.toggleSetting('shadows'));

    // sun strip drag
    const arc = $('sun-arc');
    const arcSet = (clientX) => {
        const rect = arc.getBoundingClientRect();
        const r = clamp((clientX - rect.left - 5) / 210, 0, 1);
        STATE.settings.timeOfDay = Math.round(360 + r * 840);
        updateLighting();
        if (STATE.currentModule === 'soleil') renderSoleil();
    };
    let dragging = false;
    arc.addEventListener('mousedown', (e) => { dragging = true; arcSet(e.clientX); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (dragging) arcSet(e.clientX); });
    window.addEventListener('mouseup', () => { dragging = false; });

    // command palette keyboard
    $('cmd-input').addEventListener('input', (e) => buildCmdItems(e.target.value));
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); return; }
        const open = $('cmd-overlay').classList.contains('open');
        if (open) {
            if (e.key === 'Escape') closeCmd();
            else if (e.key === 'ArrowDown') { cmdSel = Math.min(cmdSel + 1, cmdItems.length - 1); renderCmd(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { cmdSel = Math.max(cmdSel - 1, 0); renderCmd(); e.preventDefault(); }
            else if (e.key === 'Enter') runCmd(cmdSel);
            return;
        }
        if (e.key === 'Escape') {
            if (locationPickMode) { locationPickMode = false; if (map) map.getCanvas().style.cursor = ''; showToast('Annulé', 'info'); }
            else if (STATE.selection.mode) exitSelectionMode();
            else if (STATE.currentModule) closeModulePanel();
        }
    });
    $('cmd-overlay').addEventListener('click', (e) => { if (e.target.id === 'cmd-overlay') closeCmd(); });

    // Auto-refresh des couches liées au retour sur le widget (édité dans Grist ailleurs).
    window.addEventListener('focus', autoRefreshLinked);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRefreshLinked(); });
}

// ============================================================
// INIT
// ============================================================
async function init() {
    wireEvents();
    initMap();
    probeLocalModels();
    // autosave restore prompt
    try {
        const auto = localStorage.getItem('atlas_autosave');
        if (auto) {
            const p = JSON.parse(auto);
            if (p.layers?.length) {
                // restore silently after map is ready
                // Seulement en standalone : sous Grist, c'est Grist la source de vérité
                // (sinon double chargement autosave + Grist → couches en double).
                map.once('idle', () => { if (!CONFIG.grist.ready && STATE.layers.length === 0 && confirm(`Restaurer la sauvegarde locale (${p.layers.length} couches) ?`)) restoreProject(p); });
            }
        }
    } catch (e) {}
    await initGrist();
    await loadStoryFromGrist();
    setInterval(() => { if (STATE.layers.length) { try { localStorage.setItem('atlas_autosave', JSON.stringify(buildProject())); } catch (e) {} } }, 120000);
    updateLegend();
    updateSunStrip();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
