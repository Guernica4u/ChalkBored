// Downloads every ChalkBored game from games.chalkbored.win into this folder, then serves the
// folder so chalkbored-offline.html and the games work with no internet.
// Needs Node 18 or newer (nodejs.org). Put this file next to chalkbored-offline.html, then:
//   node get-games.mjs              download all games (run again to resume or update)
//   node get-games.mjs Granny       download only games whose folder or file name contains "Granny"
//   node get-games.mjs serve        start the local server and open http://localhost:8130/
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = 'https://games.chalkbored.win/';
const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8130;

async function download(filter) {
  const res = await fetch(HOST + 'files.json');
  if (!res.ok) throw new Error('could not get the game list: HTTP ' + res.status);
  let files = await res.json();   // [[path, size], ...]
  if (filter) files = files.filter(([p]) => p.toLowerCase().includes(filter.toLowerCase()));
  const todo = files.filter(([p, size]) => !(existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).size === size));
  const total = todo.reduce((s, [, size]) => s + size, 0);
  console.log(`${files.length} files, ${todo.length} to download (${(total / 1e9).toFixed(2)} GB)`);
  let done = 0, bytes = 0, failed = 0;
  const queue = todo.slice();
  async function worker() {
    for (let item; (item = queue.shift());) {
      const [p, size] = item;
      const out = join(ROOT, p);
      try {
        mkdirSync(dirname(out), { recursive: true });
        const r = await fetch(HOST + p.split('/').map(encodeURIComponent).join('/'));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await pipeline(Readable.fromWeb(r.body), createWriteStream(out + '.part-download'));
        if (statSync(out + '.part-download').size !== size) throw new Error('size mismatch');
        renameSync(out + '.part-download', out);
        bytes += size;
      } catch (e) {
        failed++;
        console.log(`  failed: ${p} (${e.message})`);
      }
      done++;
      if (done % 25 === 0 || done === todo.length) {
        console.log(`  ${done}/${todo.length} files, ${(bytes / 1e9).toFixed(2)} GB`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(failed ? `${failed} files failed; run again to retry them.` : 'All games downloaded. Next: node get-games.mjs serve');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.swf': 'application/x-shockwave-flash', '.txt': 'text/plain',
};

function serve() {
  createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }   // stay inside this folder
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}/chalkbored-offline.html`;
    console.log(`Serving ${ROOT}\nOpen ${url}  (Ctrl+C to stop)`);
    const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(open, () => {});
  });
}

const arg = process.argv[2];
if (arg === 'serve') serve();
else download(arg).catch((e) => { console.error(e.message); process.exit(1); });
