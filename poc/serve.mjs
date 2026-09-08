/* A static server for the POC, with no dependencies and no connection to the
 * main app's server. Run: node poc/serve.mjs */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
// The engine lives one level up in world/, shared with the product, so the POC
// viewer is exercising exactly the code the product ships rather than a copy.
const repo = path.dirname(root);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };
const PORT = process.env.PORT || 5174;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const base = safe.startsWith('/world/') ? repo : root;
  const file = path.join(base, safe);
  if (!file.startsWith(base)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`Graph Valley slice POC -> http://localhost:${PORT}/`));
