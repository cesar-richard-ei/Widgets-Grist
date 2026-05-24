#!/usr/bin/env node
// ============================================================
// generate-models.js — Catalogue 3D procédural pour Maquette 3D
// Génère des GLB binaires (sans dépendance) à partir de primitives,
// en plusieurs "sets" de style (colored / mono).
// Sortie : published/atlas/models/<set>/<Id>.glb + published/atlas/models/catalog.json
// ============================================================
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'published', 'atlas', 'models');

// ---------- primitives géométriques (Y up, centrées origine) ----------
function box(w, h, d) {
    const x = w / 2, y = h / 2, z = d / 2;
    const faces = [
        { n: [1, 0, 0], v: [[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]] },
        { n: [-1, 0, 0], v: [[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]] },
        { n: [0, 1, 0], v: [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]] },
        { n: [0, -1, 0], v: [[-x, -y, z], [-x, -y, -z], [x, -y, -z], [x, -y, z]] },
        { n: [0, 0, 1], v: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
        { n: [0, 0, -1], v: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
    ];
    const positions = [], normals = [], indices = []; let i = 0;
    for (const f of faces) { for (const v of f.v) { positions.push(...v); normals.push(...f.n); } indices.push(i, i + 1, i + 2, i, i + 2, i + 3); i += 4; }
    return { positions, normals, indices };
}
function cyl(rt, rb, h, seg = 14) {
    const positions = [], normals = [], indices = []; const y0 = -h / 2, y1 = h / 2; let base = 0;
    for (let s = 0; s < seg; s++) {
        const a0 = s / seg * 2 * Math.PI, a1 = (s + 1) / seg * 2 * Math.PI;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        positions.push(c0 * rb, y0, s0 * rb, c1 * rb, y0, s1 * rb, c1 * rt, y1, s1 * rt, c0 * rt, y1, s0 * rt);
        normals.push(c0, 0, s0, c1, 0, s1, c1, 0, s1, c0, 0, s0);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3); base += 4;
    }
    const cap = (y, r, ny) => {
        if (r <= 0) return; const c = base; positions.push(0, y, 0); normals.push(0, ny, 0); base++; const start = base;
        for (let s = 0; s <= seg; s++) { const a = s / seg * 2 * Math.PI; positions.push(Math.cos(a) * r, y, Math.sin(a) * r); normals.push(0, ny, 0); base++; }
        for (let s = 0; s < seg; s++) { if (ny > 0) indices.push(c, start + s, start + s + 1); else indices.push(c, start + s + 1, start + s); }
    };
    cap(y0, rb, -1); cap(y1, rt, 1);
    return { positions, normals, indices };
}
const cone = (r, h, seg = 14) => cyl(0.0001, r, h, seg);
function sphere(r, seg = 12, rings = 8) {
    const positions = [], normals = [], indices = [];
    for (let y = 0; y <= rings; y++) {
        const v = y / rings, phi = v * Math.PI;
        for (let x = 0; x <= seg; x++) {
            const u = x / seg, th = u * 2 * Math.PI;
            const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
            positions.push(nx * r, ny * r, nz * r); normals.push(nx, ny, nz);
        }
    }
    const row = seg + 1;
    for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
        const a = y * row + x, b = a + row;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return { positions, normals, indices };
}

// ---------- transformation (bake) ----------
function xf(g, o = {}) {
    const { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = o;
    const p = g.positions.slice(), n = g.normals.slice();
    for (let i = 0; i < p.length; i += 3) {
        let x = p[i] * sx, y = p[i + 1] * sy, z = p[i + 2] * sz;
        let nx = n[i] / sx, ny = n[i + 1] / sy, nz = n[i + 2] / sz;
        if (rx) { const c = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * c - z * s, y * s + z * c]; [ny, nz] = [ny * c - nz * s, ny * s + nz * c]; }
        if (ry) { const c = Math.cos(ry), s = Math.sin(ry); [x, z] = [x * c + z * s, -x * s + z * c]; [nx, nz] = [nx * c + nz * s, -nx * s + nz * c]; }
        if (rz) { const c = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * c - y * s, x * s + y * c]; [nx, ny] = [nx * c - ny * s, nx * s + ny * c]; }
        const ln = Math.hypot(nx, ny, nz) || 1;
        p[i] = x + tx; p[i + 1] = y + ty; p[i + 2] = z + tz; n[i] = nx / ln; n[i + 1] = ny / ln; n[i + 2] = nz / ln;
    }
    return { positions: p, normals: n, indices: g.indices };
}
// part(geom, role[, {emissive}])
const P = (geom, role, opt = {}) => ({ geom, role, emissive: !!opt.emissive });

// ---------- palettes (role -> hex) ----------
const COLORED = {
    metalDark: '#3b4046', metal: '#6b7178', alu: '#9aa3ab', chrome: '#c9ced3',
    wood: '#9c7a4d', woodDark: '#7a5d39', trunk: '#6b4f33',
    foliage: '#4f9a48', foliageDark: '#3a7a38', foliageLight: '#76b86a', palm: '#5aa84a',
    glass: '#a9c6d6', concrete: '#bfb9ac', stone: '#cfc8b8', white: '#eef0ee',
    red: '#d23b30', amber: '#f2b134', green: '#2ca24c', blue: '#2f6fb0',
    tyre: '#1f2124', fabric: '#cf5b46', soil: '#6e5743', skin: '#d7a07a',
    lightWarm: '#ffd89a', lightCool: '#dbe9ff', flowerA: '#e85d75', flowerB: '#f2c14e',
};
const MONO = {
    metalDark: '#9a978d', metal: '#b6b3a9', alu: '#cbc8be', chrome: '#dad7cd',
    wood: '#cfccc2', woodDark: '#b9b6ac', trunk: '#bdbab0',
    foliage: '#d3d0c7', foliageDark: '#c2bfb6', foliageLight: '#dedbd2', palm: '#cdcabf',
    glass: '#d2d8db', concrete: '#d8d4ca', stone: '#e0dccf', white: '#eef0ee',
    red: '#bdbab0', amber: '#cbc8be', green: '#c6c3ba', blue: '#c2bfb6',
    tyre: '#8f8c82', fabric: '#cbc8be', soil: '#c4c0b6', skin: '#dad7cd',
    lightWarm: '#ffe1ad', lightCool: '#e6efff', flowerA: '#d6d3c9', flowerB: '#dedbd2',
};
const SETS = { colored: COLORED, mono: MONO };
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

// ============================================================
// GLB writer
// ============================================================
function buildGLB(parts, palette) {
    // regroupe par (role+emissive) → 1 primitive/matériau
    const groups = new Map();
    for (const part of parts) {
        const key = part.role + (part.emissive ? '|E' : '');
        if (!groups.has(key)) groups.set(key, { role: part.role, emissive: part.emissive, positions: [], normals: [], indices: [] });
        const g = groups.get(key), off = g.positions.length / 3;
        g.positions.push(...part.geom.positions); g.normals.push(...part.geom.normals);
        for (const idx of part.geom.indices) g.indices.push(idx + off);
    }
    // shift global → base au sol (minY = 0)
    let minY = Infinity, maxY = -Infinity;
    for (const g of groups.values()) for (let i = 1; i < g.positions.length; i += 3) { minY = Math.min(minY, g.positions[i]); maxY = Math.max(maxY, g.positions[i]); }
    const shift = -minY;

    const bin = []; let byteLen = 0;
    const bufferViews = [], accessors = [], materials = [], primitives = [];
    const matIndex = new Map();
    const pushBV = (buf, target) => {
        while (byteLen % 4 !== 0) { bin.push(Buffer.alloc(4 - (byteLen % 4))); byteLen += 4 - (byteLen % 4); }
        const off = byteLen; bin.push(buf); byteLen += buf.length;
        bufferViews.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) });
        return bufferViews.length - 1;
    };

    for (const g of groups.values()) {
        const n = g.positions.length / 3;
        const pos = Buffer.alloc(n * 12), nor = Buffer.alloc(n * 12);
        let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
        for (let i = 0; i < n; i++) {
            const x = g.positions[i * 3], y = g.positions[i * 3 + 1] + shift, z = g.positions[i * 3 + 2];
            pos.writeFloatLE(x, i * 12); pos.writeFloatLE(y, i * 12 + 4); pos.writeFloatLE(z, i * 12 + 8);
            nor.writeFloatLE(g.normals[i * 3], i * 12); nor.writeFloatLE(g.normals[i * 3 + 1], i * 12 + 4); nor.writeFloatLE(g.normals[i * 3 + 2], i * 12 + 8);
            mnx = Math.min(mnx, x); mny = Math.min(mny, y); mnz = Math.min(mnz, z); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y); mxz = Math.max(mxz, z);
        }
        const idx = Buffer.alloc(g.indices.length * 4);
        for (let i = 0; i < g.indices.length; i++) idx.writeUInt32LE(g.indices[i], i * 4);

        const posBV = pushBV(pos, 34962), norBV = pushBV(nor, 34962), idxBV = pushBV(idx, 34963);
        const posAcc = accessors.push({ bufferView: posBV, componentType: 5126, count: n, type: 'VEC3', min: [mnx, mny, mnz], max: [mxx, mxy, mxz] }) - 1;
        const norAcc = accessors.push({ bufferView: norBV, componentType: 5126, count: n, type: 'VEC3' }) - 1;
        const idxAcc = accessors.push({ bufferView: idxBV, componentType: 5125, count: g.indices.length, type: 'SCALAR' }) - 1;

        const mkey = g.role + (g.emissive ? '|E' : '');
        if (!matIndex.has(mkey)) {
            const rgb = hex2rgb(palette[g.role] || '#cccccc');
            const mat = { name: mkey, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...rgb, 1], metallicFactor: /metal|chrome|alu/.test(g.role) ? 0.7 : 0.0, roughnessFactor: /metal|chrome|alu|glass/.test(g.role) ? 0.35 : 0.85 } };
            if (g.emissive) { mat.emissiveFactor = rgb; mat.pbrMetallicRoughness.baseColorFactor = [rgb[0] * 0.4, rgb[1] * 0.4, rgb[2] * 0.4, 1]; }
            matIndex.set(mkey, materials.push(mat) - 1);
        }
        primitives.push({ attributes: { POSITION: posAcc, NORMAL: norAcc }, indices: idxAcc, material: matIndex.get(mkey) });
    }

    const binBuf = Buffer.concat(bin);
    const gltf = {
        asset: { version: '2.0', generator: 'maquette3d/generate-models' },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'model' }],
        meshes: [{ primitives }], materials, accessors, bufferViews,
        buffers: [{ byteLength: binBuf.length }],
    };
    let json = Buffer.from(JSON.stringify(gltf), 'utf8');
    while (json.length % 4 !== 0) json = Buffer.concat([json, Buffer.from(' ')]);
    let binPad = binBuf; while (binPad.length % 4 !== 0) binPad = Buffer.concat([binPad, Buffer.alloc(1)]);
    const total = 12 + 8 + json.length + 8 + binPad.length;
    const header = Buffer.alloc(12); header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
    const jsonHdr = Buffer.alloc(8); jsonHdr.writeUInt32LE(json.length, 0); jsonHdr.writeUInt32LE(0x4E4F534A, 4);
    const binHdr = Buffer.alloc(8); binHdr.writeUInt32LE(binPad.length, 0); binHdr.writeUInt32LE(0x004E4942, 4);
    return { glb: Buffer.concat([header, jsonHdr, json, binHdr, binPad]), height: +(maxY - minY).toFixed(2) };
}

// ============================================================
// CATALOGUE — builders (dimensions en mètres réels, base au sol)
// ============================================================
const reps = (n, f) => Array.from({ length: n }, (_, i) => f(i)).flat();

const CATALOG = [
    // ── ÉCLAIRAGE ──────────────────────────────
    { id: 'streetlamp', name: 'Lampadaire', icon: '🏮', cat: 'lighting', build: () => [
        P(xf(cyl(0.07, 0.11, 8), { ty: 4 }), 'metal'),
        P(xf(box(2.2, 0.12, 0.12), { tx: 0.9, ty: 8 }), 'metal'),
        P(xf(box(0.5, 0.18, 0.3), { tx: 1.9, ty: 7.95 }), 'metalDark'),
        P(xf(box(0.44, 0.06, 0.24), { tx: 1.9, ty: 7.86 }), 'lightWarm', { emissive: true }),
    ]},
    { id: 'streetlamp_double', name: 'Lampadaire double', icon: '🏮', cat: 'lighting', build: () => [
        P(xf(cyl(0.08, 0.12, 8.5), { ty: 4.25 }), 'metal'),
        ...[1, -1].flatMap((s) => [
            P(xf(box(2.2, 0.12, 0.12), { tx: 0.9 * s, ty: 8.4 }), 'metal'),
            P(xf(box(0.5, 0.18, 0.3), { tx: 1.9 * s, ty: 8.35 }), 'metalDark'),
            P(xf(box(0.44, 0.06, 0.24), { tx: 1.9 * s, ty: 8.26 }), 'lightWarm', { emissive: true }),
        ]),
    ]},
    { id: 'lantern', name: 'Lanterne', icon: '🏮', cat: 'lighting', build: () => [
        P(xf(cyl(0.05, 0.09, 3.4), { ty: 1.7 }), 'metalDark'),
        P(xf(box(0.45, 0.55, 0.45), { ty: 3.75 }), 'glass'),
        P(xf(box(0.32, 0.4, 0.32), { ty: 3.72 }), 'lightWarm', { emissive: true }),
        P(xf(cone(0.36, 0.3), { ty: 4.18 }), 'metalDark'),
    ]},
    { id: 'lampball', name: 'Lampe boule', icon: '💡', cat: 'lighting', build: () => [
        P(xf(cyl(0.06, 0.08, 3.6), { ty: 1.8 }), 'metalDark'),
        P(xf(sphere(0.32), { ty: 3.9 }), 'lightWarm', { emissive: true }),
    ]},
    { id: 'wall_light', name: 'Applique', icon: '🔆', cat: 'lighting', build: () => [
        P(xf(box(0.1, 0.5, 0.4), { tx: -0.05 }), 'metalDark'),
        P(xf(box(0.28, 0.28, 0.34), { tx: 0.2, ty: 0.05 }), 'lightWarm', { emissive: true }),
    ]},
    { id: 'projector', name: 'Projecteur', icon: '🔦', cat: 'lighting', build: () => [
        P(xf(cyl(0.06, 0.08, 9), { ty: 4.5 }), 'metal'),
        P(xf(box(0.5, 0.3, 0.4), { ty: 9, rz: -0.5 }), 'metalDark'),
        P(xf(box(0.4, 0.06, 0.32), { ty: 8.92, rz: -0.5 }), 'lightCool', { emissive: true }),
    ]},

    // ── MOBILIER URBAIN ────────────────────────
    { id: 'bench', name: 'Banc', icon: '🪑', cat: 'furniture', build: () => [
        ...reps(3, (i) => P(xf(box(1.8, 0.05, 0.13), { ty: 0.45, tz: -0.18 + i * 0.16 }), 'wood')),
        ...reps(3, (i) => P(xf(box(1.8, 0.13, 0.05), { ty: 0.7, tz: -0.22 + i * 0.07 }), 'wood')),
        ...[-0.8, 0.8].flatMap((x) => [P(xf(box(0.08, 0.45, 0.5), { tx: x, ty: 0.225 }), 'metalDark')]),
    ]},
    { id: 'bench_simple', name: 'Banc simple', icon: '🪑', cat: 'furniture', build: () => [
        P(xf(box(1.6, 0.08, 0.45), { ty: 0.45 }), 'wood'),
        ...[-0.7, 0.7].flatMap((x) => [P(xf(box(0.07, 0.45, 0.4), { tx: x, ty: 0.225 }), 'metalDark')]),
    ]},
    { id: 'picnic_table', name: 'Table pique-nique', icon: '🪵', cat: 'furniture', build: () => [
        P(xf(box(1.8, 0.06, 0.7), { ty: 0.74 }), 'wood'),
        ...[-0.55, 0.55].flatMap((z) => [P(xf(box(1.8, 0.05, 0.28), { ty: 0.45, tz: z }), 'wood')]),
        ...[-0.7, 0.7].flatMap((x) => [P(xf(box(0.08, 0.74, 1.4), { tx: x, ty: 0.37, rx: 0 }), 'metalDark')]),
    ]},
    { id: 'trashcan', name: 'Poubelle', icon: '🗑️', cat: 'furniture', build: () => [
        P(xf(cyl(0.26, 0.24, 0.9), { ty: 0.45 }), 'metal'),
        P(xf(cyl(0.29, 0.28, 0.1), { ty: 0.93 }), 'metalDark'),
    ]},
    { id: 'bus_shelter', name: 'Abri bus', icon: '🚏', cat: 'furniture', build: () => [
        P(xf(box(4, 0.12, 1.5), { ty: 2.5 }), 'metalDark'),
        P(xf(box(3.8, 2.2, 0.06), { ty: 1.4, tz: -0.7 }), 'glass'),
        ...[-1.9, 1.9].flatMap((x) => [P(xf(cyl(0.05, 0.05, 2.5), { tx: x, ty: 1.25, tz: 0.6 }), 'metal')]),
        P(xf(box(1.6, 0.06, 0.35), { ty: 0.5, tz: -0.5 }), 'wood'),
    ]},
    { id: 'bike_rack', name: 'Arceau vélo', icon: '🚲', cat: 'furniture', build: () => [
        ...[-0.4, 0.4].flatMap((x) => P(xf(cyl(0.03, 0.03, 0.8), { tx: x, ty: 0.4 }), 'metal')),
        P(xf(cyl(0.03, 0.03, 0.8, 10), { ty: 0.8, tx: 0, rz: Math.PI / 2 }), 'metal'),
    ]},
    { id: 'planter', name: 'Jardinière', icon: '🪴', cat: 'furniture', build: () => [
        P(xf(box(1.2, 0.5, 0.6), { ty: 0.25 }), 'wood'),
        P(xf(box(1.1, 0.15, 0.5), { ty: 0.52 }), 'soil'),
        ...reps(4, (i) => P(xf(sphere(0.18, 8, 6), { tx: -0.35 + i * 0.25, ty: 0.7, tz: (i % 2 ? 0.1 : -0.1) }), 'foliage')),
    ]},
    { id: 'fountain', name: 'Fontaine', icon: '⛲', cat: 'furniture', build: () => [
        P(xf(cyl(0.6, 0.65, 0.4), { ty: 0.2 }), 'stone'),
        P(xf(cyl(0.5, 0.5, 0.06), { ty: 0.4 }), 'glass'),
        P(xf(cyl(0.12, 0.14, 1.1), { ty: 0.55 }), 'stone'),
    ]},
    { id: 'ev_charger', name: 'Borne recharge', icon: '⚡', cat: 'furniture', build: () => [
        P(xf(box(0.4, 1.4, 0.3), { ty: 0.7 }), 'white'),
        P(xf(box(0.3, 0.4, 0.04), { ty: 1.05, tz: 0.16 }), 'lightCool', { emissive: true }),
    ]},

    // ── VÉGÉTATION ─────────────────────────────
    { id: 'tree_deciduous', name: 'Arbre feuillu', icon: '🌳', cat: 'vegetation', build: () => [
        P(xf(cyl(0.18, 0.24, 3), { ty: 1.5 }), 'trunk'),
        P(xf(sphere(1.7, 12, 9), { ty: 4.2 }), 'foliage'),
        P(xf(sphere(1.1, 10, 8), { tx: -0.9, ty: 3.6 }), 'foliageDark'),
        P(xf(sphere(1.1, 10, 8), { tx: 1, ty: 3.8 }), 'foliageLight'),
    ]},
    { id: 'tree_conifer', name: 'Conifère', icon: '🌲', cat: 'vegetation', build: () => [
        P(xf(cyl(0.14, 0.2, 1.4), { ty: 0.7 }), 'trunk'),
        P(xf(cone(1.5, 2.6), { ty: 2.2 }), 'foliageDark'),
        P(xf(cone(1.2, 2.2), { ty: 3.6 }), 'foliage'),
        P(xf(cone(0.8, 1.8), { ty: 5 }), 'foliageDark'),
    ]},
    { id: 'tree_palm', name: 'Palmier', icon: '🌴', cat: 'vegetation', build: () => [
        ...reps(6, (i) => P(xf(cyl(0.16, 0.18, 1), { ty: 0.5 + i, tz: Math.sin(i) * 0.06, tx: Math.cos(i) * 0.05 }), 'trunk')),
        ...reps(7, (i) => P(xf(box(2.4, 0.06, 0.35), { tx: 1.1, ty: 6.1, ry: i / 7 * 2 * Math.PI, rz: -0.25 }), 'palm')),
    ]},
    { id: 'bush', name: 'Buisson', icon: '🌿', cat: 'vegetation', build: () => [
        P(xf(sphere(0.55, 10, 7), { ty: 0.45 }), 'foliage'),
        P(xf(sphere(0.42, 8, 6), { tx: 0.45, ty: 0.38 }), 'foliageDark'),
        P(xf(sphere(0.42, 8, 6), { tx: -0.45, ty: 0.4 }), 'foliageLight'),
    ]},
    { id: 'hedge', name: 'Haie', icon: '🌳', cat: 'vegetation', build: () => [
        P(xf(box(2.5, 1.1, 0.6), { ty: 0.55 }), 'foliage'),
        P(xf(box(2.4, 0.2, 0.5), { ty: 1.1 }), 'foliageLight'),
    ]},
    { id: 'flowerbed', name: 'Parterre fleuri', icon: '🌷', cat: 'vegetation', build: () => [
        P(xf(box(1.6, 0.16, 1), { ty: 0.08 }), 'soil'),
        ...reps(10, (i) => P(xf(sphere(0.1, 6, 5), { tx: -0.6 + (i % 5) * 0.3, ty: 0.26, tz: i < 5 ? -0.22 : 0.22 }), i % 2 ? 'flowerA' : 'flowerB')),
        ...reps(10, (i) => P(xf(cyl(0.015, 0.015, 0.18), { tx: -0.6 + (i % 5) * 0.3, ty: 0.17, tz: i < 5 ? -0.22 : 0.22 }), 'foliageDark')),
    ]},

    // ── SIGNALISATION ──────────────────────────
    { id: 'traffic_light', name: 'Feu tricolore', icon: '🚦', cat: 'signalization', build: () => [
        P(xf(cyl(0.07, 0.1, 3.2), { ty: 1.6 }), 'metalDark'),
        P(xf(box(0.3, 0.85, 0.25), { ty: 3.2 }), 'metalDark'),
        P(xf(sphere(0.1, 8, 6), { ty: 3.45, tz: 0.13 }), 'red', { emissive: true }),
        P(xf(sphere(0.1, 8, 6), { ty: 3.2, tz: 0.13 }), 'amber', { emissive: true }),
        P(xf(sphere(0.1, 8, 6), { ty: 2.95, tz: 0.13 }), 'green', { emissive: true }),
    ]},
    { id: 'stop_sign', name: 'Panneau stop', icon: '🛑', cat: 'signalization', build: () => [
        P(xf(cyl(0.04, 0.04, 2.2), { ty: 1.1 }), 'metal'),
        P(xf(cyl(0.4, 0.4, 0.05, 8), { ty: 2.1, rz: Math.PI / 2, ry: Math.PI / 8 }), 'red'),
    ]},
    { id: 'directional_sign', name: 'Panneau directionnel', icon: '🪧', cat: 'signalization', build: () => [
        P(xf(cyl(0.05, 0.05, 2.6), { ty: 1.3 }), 'metal'),
        P(xf(box(1.1, 0.4, 0.04), { tx: 0.45, ty: 2.3 }), 'blue'),
    ]},
    { id: 'bollard', name: 'Potelet', icon: '🔶', cat: 'signalization', build: () => [
        P(xf(cyl(0.06, 0.07, 0.95), { ty: 0.475 }), 'metalDark'),
        P(xf(cyl(0.07, 0.07, 0.08), { ty: 0.85 }), 'amber', { emissive: true }),
        P(xf(sphere(0.08, 8, 6), { ty: 0.95 }), 'metalDark'),
    ]},
    { id: 'barrier', name: 'Barrière', icon: '🚧', cat: 'signalization', build: () => [
        ...[-1, 1].flatMap((x) => P(xf(cyl(0.04, 0.05, 1.05), { tx: x, ty: 0.525 }), 'metal')),
        ...[0.95, 0.55].flatMap((y) => P(xf(box(2.2, 0.08, 0.06), { ty: y }), 'red')),
    ]},

    // ── VOIRIE / INFRASTRUCTURE ────────────────
    { id: 'guardrail', name: 'Glissière', icon: '🚧', cat: 'infrastructure', build: () => [
        ...reps(3, (i) => P(xf(box(0.08, 0.7, 0.08), { tx: -1.6 + i * 1.6, ty: 0.35 }), 'metalDark')),
        P(xf(box(3.6, 0.25, 0.06), { ty: 0.6 }), 'chrome'),
    ]},
    { id: 'stone_bollard', name: 'Borne béton', icon: '🪨', cat: 'infrastructure', build: () => [
        P(xf(cyl(0.18, 0.22, 0.7, 8), { ty: 0.35 }), 'concrete'),
        P(xf(cone(0.2, 0.12, 8), { ty: 0.72 }), 'concrete'),
    ]},
    { id: 'pole', name: 'Poteau', icon: '🔲', cat: 'infrastructure', build: () => [
        P(xf(cyl(0.09, 0.12, 6), { ty: 3 }), 'metal'),
    ]},
    { id: 'fire_hydrant', name: 'Borne incendie', icon: '🧯', cat: 'infrastructure', build: () => [
        P(xf(cyl(0.13, 0.15, 0.7), { ty: 0.35 }), 'red'),
        P(xf(sphere(0.14, 10, 6), { ty: 0.72 }), 'red'),
        ...[-1, 1].flatMap((x) => P(xf(cyl(0.05, 0.05, 0.16), { tx: x * 0.14, ty: 0.45, rz: Math.PI / 2 }), 'metalDark')),
    ]},
    { id: 'manhole', name: 'Regard', icon: '⚫', cat: 'infrastructure', build: () => [
        P(xf(cyl(0.32, 0.32, 0.04, 16), { ty: 0.02 }), 'metalDark'),
    ]},

    // ── VÉHICULES ──────────────────────────────
    { id: 'car', name: 'Voiture', icon: '🚗', cat: 'vehicles', build: () => [
        P(xf(box(4.2, 0.6, 1.8), { ty: 0.6 }), 'blue'),
        P(xf(box(2.4, 0.65, 1.65), { ty: 1.15, tx: -0.2 }), 'glass'),
        ...[[1.4, 0.65], [1.4, -0.65], [-1.4, 0.65], [-1.4, -0.65]].flatMap(([x, z]) => P(xf(cyl(0.33, 0.33, 0.25, 12), { tx: x, ty: 0.33, tz: z, rz: Math.PI / 2 }), 'tyre')),
    ]},
    { id: 'van', name: 'Camionnette', icon: '🚐', cat: 'vehicles', build: () => [
        P(xf(box(5, 1.6, 2), { ty: 1.1 }), 'white'),
        P(xf(box(1.2, 0.7, 1.9), { ty: 1.1, tx: 2 }), 'glass'),
        ...[[1.6, 0.9], [1.6, -0.9], [-1.6, 0.9], [-1.6, -0.9]].flatMap(([x, z]) => P(xf(cyl(0.38, 0.38, 0.28, 12), { tx: x, ty: 0.38, tz: z, rz: Math.PI / 2 }), 'tyre')),
    ]},
    { id: 'bus', name: 'Bus', icon: '🚌', cat: 'vehicles', build: () => [
        P(xf(box(11, 2.6, 2.5), { ty: 1.6 }), 'green'),
        ...reps(5, (i) => P(xf(box(1.4, 0.9, 2.52), { tx: -4 + i * 2, ty: 2 }), 'glass')),
        ...[[3.5, 1.3], [3.5, -1.3], [-3, 1.3], [-3, -1.3]].flatMap(([x, z]) => P(xf(cyl(0.5, 0.5, 0.3, 12), { tx: x, ty: 0.5, tz: z, rz: Math.PI / 2 }), 'tyre')),
    ]},
    { id: 'bicycle', name: 'Vélo', icon: '🚲', cat: 'vehicles', build: () => [
        ...[-0.55, 0.55].flatMap((x) => P(xf(cyl(0.34, 0.34, 0.05, 16), { tx: x, ty: 0.34, rz: Math.PI / 2 }), 'tyre')),
        P(xf(cyl(0.02, 0.02, 1.05, 8), { ty: 0.55, rz: Math.PI / 2 + 0.2 }), 'metal'),
        P(xf(cyl(0.02, 0.02, 0.5, 8), { tx: 0.5, ty: 0.7, rz: 0.2 }), 'metal'),
        P(xf(box(0.3, 0.05, 0.12), { tx: -0.4, ty: 0.95 }), 'metalDark'),
    ]},
    { id: 'scooter', name: 'Trottinette', icon: '🛴', cat: 'vehicles', build: () => [
        P(xf(box(0.7, 0.06, 0.16), { ty: 0.14 }), 'metalDark'),
        ...[-0.32, 0.32].flatMap((x) => P(xf(cyl(0.12, 0.12, 0.04, 12), { tx: x, ty: 0.12, rz: Math.PI / 2 }), 'tyre')),
        P(xf(cyl(0.02, 0.02, 1, 8), { tx: 0.32, ty: 0.6 }), 'metal'),
        P(xf(box(0.04, 0.04, 0.4), { tx: 0.32, ty: 1.05 }), 'metalDark'),
    ]},
    { id: 'pedestrian', name: 'Piéton', icon: '🚶', cat: 'vehicles', build: () => [
        P(xf(sphere(0.13, 10, 8), { ty: 1.62 }), 'skin'),
        P(xf(box(0.34, 0.6, 0.2), { ty: 1.15 }), 'fabric'),
        ...[-0.1, 0.1].flatMap((x) => P(xf(cyl(0.07, 0.07, 0.85), { tx: x, ty: 0.42 }), 'metalDark')),
    ]},
];

// ============================================================
// GÉNÉRATION
// ============================================================
const CAT_META = {
    lighting: { icon: '💡', name: 'Éclairage' }, furniture: { icon: '🪑', name: 'Mobilier urbain' },
    vegetation: { icon: '🌳', name: 'Végétation' }, signalization: { icon: '🚦', name: 'Signalisation' },
    infrastructure: { icon: '🚧', name: 'Infrastructure' }, vehicles: { icon: '🚗', name: 'Véhicules' },
};
const fileName = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('') + '.glb';

function run() {
    const sets = Object.keys(SETS);
    for (const set of sets) fs.mkdirSync(path.join(OUT, set), { recursive: true });
    const catalog = { generatedAt: new Date().toISOString(), sets, categories: CAT_META, models: [] };
    let total = 0;
    for (const item of CATALOG) {
        const parts = item.build();
        const file = fileName(item.id);
        let height = 0;
        for (const set of sets) {
            const { glb, height: h } = buildGLB(parts, SETS[set]);
            fs.writeFileSync(path.join(OUT, set, file), glb);
            height = h; total++;
        }
        catalog.models.push({ id: item.id, name: item.name, icon: item.icon, category: item.cat, file, heightMeters: height });
        console.log(`  ✓ ${item.id} (${file}) — h≈${height}m`);
    }
    fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 2));
    console.log(`\n✅ ${CATALOG.length} modèles × ${sets.length} sets = ${total} GLB → published/atlas/models/`);
    console.log(`   catalog.json : ${CATALOG.length} entrées`);
}
run();
