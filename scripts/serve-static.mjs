#!/usr/bin/env node
// Serve a built site under a base path, like GitHub Pages does: node scripts/serve-static.mjs <dir> <port> [/Sidequest]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const [dir = 'dist', port = '4331', base = '/Sidequest'] = process.argv.slice(2);
const root = resolve(dir);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith(base)) { res.writeHead(302, { Location: `${base}/` }); return res.end(); }
  let file = normalize(join(root, path.slice(base.length) || '/'));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(Number(port), '127.0.0.1', () => console.log(`serving ${root} at http://127.0.0.1:${port}${base}/`));
