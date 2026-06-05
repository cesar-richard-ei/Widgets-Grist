#!/usr/bin/env node
/*
 * serve-dev.js — Serveur statique minimal pour tester les widgets dans Grist.
 *
 * Zero dependance (http + fs natifs). Sert le dossier projects/ par defaut, avec
 * en-tetes CORS et SANS X-Frame-Options (Grist doit pouvoir charger le widget en
 * iframe). http://localhost est traite comme origine sure par les navigateurs,
 * donc utilisable depuis un Grist en HTTPS (docs.getgrist.com) sans souci de
 * mixed-content.
 *
 * Usage : node scripts/serve-dev.js [--root projects] [--port 3001]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

function arg(name, def) {
    const i = process.argv.indexOf('--' + name);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const ROOT = path.resolve(__dirname, '..', arg('root', 'projects'));
const PORT = parseInt(arg('port', '3001'), 10);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2'
};

function send(res, code, body, headers) {
    res.writeHead(code, Object.assign({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Cache-Control': 'no-store'
    }, headers || {}));
    res.end(body);
}

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204, '');

    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { return send(res, 400, 'Bad URL'); }

    // Resolution securisee (empeche de sortir de ROOT via ../).
    const target = path.normalize(path.join(ROOT, urlPath));
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');

    fs.stat(target, (err, stat) => {
        if (err) return send(res, 404, 'Not found: ' + urlPath);
        const file = stat.isDirectory() ? path.join(target, 'index.html') : target;
        fs.readFile(file, (e, data) => {
            if (e) return send(res, 404, 'Not found: ' + urlPath);
            send(res, 200, data, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        });
    });
});

server.listen(PORT, () => {
    console.log('TaskFlow dev server');
    console.log('  racine : ' + ROOT);
    console.log('  url    : http://localhost:' + PORT + '/');
    console.log('  ex.    : http://localhost:' + PORT + '/tasks_app/kanban.html');
});
