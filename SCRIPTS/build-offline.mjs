// Builds chalkbored-offline.html: the Study Hall page as one file, with its scripts, icon and
// card covers inlined, so it opens from a USB stick or Downloads.
//   node SCRIPTS/build-offline.mjs            (run from the repo folder; writes chalkbored-offline.html)
// Games load from games.chalkbored.win, or from the same folder when get-games.mjs serves it.
// Music, TV, Browser and Chat are separate pages that need the website.
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const dataUri = (p) => {
  const type = { svg: 'image/svg+xml', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[p.split('.').pop().toLowerCase()];
  if (!type) throw new Error('unknown image type: ' + p);
  return `data:${type};base64,${readFileSync(p).toString('base64')}`;
};
const once = (text, from, to) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`expected one "${from.slice(0, 60)}", found ${n}`);
  return text.replace(from, () => to);
};
// a script's own text must not end the inline <script> early
const inline = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;

let subjects = read('subjects.js');
subjects = once(subjects, "const LESSON_HOST = 'https://games.chalkbored.win/';",
  "// offline copy: games come from this folder when get-games.mjs serves it, else from the games host\n" +
  "const LESSON_HOST = location.protocol === 'file:' ? 'https://games.chalkbored.win/' : './';");
subjects = subjects.replace(/src: '(LESSONS\/art\/[^']+)'/g, (_, p) => `src: '${dataUri(p)}'`);

let html = read('study-hall/algebra.html');
html = once(html, '<link rel="icon" href="favicon.svg">', `<link rel="icon" href="${dataUri('favicon.svg')}">`);
html = once(html, '<script src="subjects.js"></script>', inline(subjects));
for (const src of ['home.js', 'listening/notebook.js', 'notify.js']) {
  html = once(html, `<script src="${src}"></script>`, inline(read(src)));
}
const left = [...html.matchAll(/<script src="(?!https?:)([^"]+)"/g)].map((m) => m[1]);
if (left.length) throw new Error('local scripts not inlined: ' + left.join(', '));

writeFileSync('chalkbored-offline.html', html);
console.log(`chalkbored-offline.html: ${(html.length / 1e6).toFixed(1)} MB`);
