#!/usr/bin/env node
/* Serveur local qui résout les adresses comme GitHub Pages (vérifié le 2026-11-06) :
   /x → x, puis x.html, puis x/index.html ; /x/ → x/index.html ; sinon 404.html.
   `npx serve` donne la priorité au dossier : /boutique y tomberait sur boutique/index.html.
   Usage : node tools/serve-pages.js [port] */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.argv[2] || 8777;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2' };

const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };

function resolve(urlPath) {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^[\\/]+/, '');
  const base = path.join(ROOT, rel);
  if (base !== ROOT && !base.startsWith(ROOT + path.sep)) return null;
  if (urlPath.endsWith('/')) return isFile(path.join(base, 'index.html')) ? path.join(base, 'index.html') : null;
  if (isFile(base)) return base;
  if (isFile(base + '.html')) return base + '.html';
  if (isFile(path.join(base, 'index.html'))) return { redirect: urlPath + '/' };
  return null;
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  let hit = null;
  try { hit = resolve(u.pathname); } catch (e) { hit = null; }
  if (hit && hit.redirect) { res.writeHead(301, { Location: hit.redirect + u.search }); res.end(); return; }
  const file = hit || path.join(ROOT, '404.html');
  res.writeHead(hit ? 200 : 404, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('http://localhost:' + PORT));
