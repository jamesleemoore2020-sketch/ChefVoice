// Serves web/ the way Firebase Hosting does, for local checks and the browser smoke spec.
//
// Files are served as they are, with the headers the pwa target in firebase.json gives
// them: Cache-Control, and the security headers and Content-Security-Policy, so every
// local run and every spec runs under the policy Hosting sends. Every other path -- and
// anything the pwa target's "ignore" list keeps off Hosting -- falls through to
// index.html, like the "**" rewrite in firebase.json. No dependencies, so it runs anywhere
// `node` does: `node e2e/serve.mjs` from the repo root, PORT to change the port.
// .claude/launch.json uses it for the Browser pane preview.
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const port = Number(process.env.PORT || 4173);

// Hosting matches a header rule against the path requested, not the rewrite's destination,
// so a deep link served index.html gets the "**" rule and not the "/index.html" one. A glob
// this cannot translate stops the server rather than silently dropping its headers.
function globToRegExp(glob) {
  if (typeof glob !== 'string' || /[?[\]{}()!+@]/.test(glob)) throw new Error(`serve.mjs cannot mirror the Hosting header rule "${glob}"`);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${glob.split('**').map((part) => part.split('*').map(escape).join('[^/]*')).join('.*')}$`);
}

const firebaseJson = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
const pwaTarget = firebaseJson.hosting.find((h) => h.target === 'pwa');
const headerRules = (pwaTarget.headers || [])
  .map((rule) => ({ matches: globToRegExp(rule.source), headers: rule.headers }));

// Rewrites to a Cloud Function, answered here the way the function answers them. Only functions
// this file knows are mirrored; a new one stops the server rather than silently serving
// index.html in its place. The share page is always the generic one: there is no Firestore
// here, and "not a public recipe" is the answer that function gives when it cannot read one.
const require = createRequire(import.meta.url);
const functionPages = {
  recipeSharePage: (pathname) => {
    const { recipeIdFromPath, renderSharePage } = require('../share/functions/share-page.js');
    return renderSharePage({ id: recipeIdFromPath(pathname), recipe: null });
  }
};
const functionRules = (pwaTarget.rewrites || []).filter((rule) => rule.function).map((rule) => {
  const page = functionPages[rule.function.functionId];
  if (!page) throw new Error(`serve.mjs cannot mirror the Hosting rewrite to function "${rule.function.functionId}"`);
  return { matches: globToRegExp(rule.source), page };
});

function hostingHeaders(pathname) {
  // no-cache for anything the rules leave alone: nothing local should be served stale.
  const headers = { 'Cache-Control': 'no-cache' };
  for (const rule of headerRules) {
    if (!rule.matches.test(pathname)) continue;
    for (const { key, value } of rule.headers) headers[key] = value;
  }
  return headers;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Mirrors the pwa target's "ignore" list in firebase.json: never published, so never served.
function unpublished(relative) {
  const parts = relative.split('/');
  return parts.some((p) => p.startsWith('.') || p === 'node_modules' || p === 'tests')
    || ['package.json', 'package-lock.json', 'README.md'].includes(parts[parts.length - 1]);
}

async function resolveFile(pathname) {
  let relative;
  try { relative = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return null; }
  if (!relative) return join(root, 'index.html');
  if (unpublished(relative)) return null;
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    const info = await stat(file);
    if (info.isFile()) return file;
    if (info.isDirectory()) {
      const index = join(file, 'index.html');
      if ((await stat(index)).isFile()) return index;
    }
  } catch { /* not a file: rewritten below */ }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Hosting serves a file that exists before it applies any rewrite, then the first rewrite that
  // matches. The function's own headers come first; Hosting's rules for the path win over them.
  const existing = await resolveFile(url.pathname);
  const rewrite = !existing && functionRules.find((rule) => rule.matches.test(url.pathname));
  if (rewrite) {
    const page = rewrite.page(url.pathname);
    res.writeHead(200, { ...page.headers, ...hostingHeaders(url.pathname) });
    res.end(req.method === 'HEAD' ? undefined : page.html);
    return;
  }
  const file = existing || join(root, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      ...hostingHeaders(url.pathname),
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Could not read ' + file);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`ChefVoice PWA on http://127.0.0.1:${port}/ (serving ${root})`);
});
