// Minimal static server for docs/ when Python is not installed: node tools/serve.mjs [port]
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('../docs/', import.meta.url)));
const port = Number(process.argv[2] || 8765);
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = join(root, normalize(path === '/' ? '/index.html' : path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
    res.end(body);
  } catch {
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/ ← ${root}`));
