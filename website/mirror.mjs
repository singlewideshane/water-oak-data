// Copies every file of the live singlewideshane.com deploy into ./site, using
// Netlify's file list, and points the market box at the robot's data file on
// GitHub (falls back to the site's own copy). Exits non-zero if ANY file fails,
// so a partial site is never deployed.
import fs from 'node:fs';
import path from 'node:path';

const SITE_ID = '827b9554-a0a8-4394-ab89-fe6b27aa8108';
const ORIGIN = 'https://singlewideshane.com';
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
if (!TOKEN) { console.log('NETLIFY_AUTH_TOKEN secret is missing.'); process.exit(1); }

const api = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/files`, { headers: { Authorization: `Bearer ${TOKEN}` } });
if (!api.ok) { console.log('Netlify file list failed', api.status); process.exit(1); }
const files = await api.json();
console.log('Live site files:', files.length);
let failed = 0;
for (const f of files) {
  const rel = f.path.replace(/^\/+/, '');
  if (!rel || rel.startsWith('.netlify')) continue;
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    try {
      const r = await fetch(ORIGIN + '/' + rel.split('/').map(encodeURIComponent).join('/'), { redirect: 'manual' });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        fs.mkdirSync(path.dirname('site/' + rel), { recursive: true });
        fs.writeFileSync('site/' + rel, buf);
        ok = f.size == null || buf.length === f.size || /\.html?$/.test(rel);
        if (!ok) console.log('size mismatch', rel, buf.length, f.size);
      } else console.log('HTTP', r.status, rel);
    } catch (e) { console.log('fetch error', rel, e.message); }
  }
  if (!ok) failed++;
}
if (failed) { console.log(failed, 'files could not be copied. Not deploying.'); process.exit(1); }

const OLD = "fetch('/data/water-oak-market.json',{cache:'no-store'})";
const NEW = "fetch('https://raw.githubusercontent.com/SinglewideSHANE/water-oak-data/main/data/water-oak-market.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r}).catch(function(){return fetch('/data/water-oak-market.json',{cache:'no-store'})})";
let patched = 0;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!/\.html?$/.test(e.name)) return;
  const s = fs.readFileSync(p, 'utf8');
  if (s.includes(OLD)) { fs.writeFileSync(p, s.split(OLD).join(NEW)); patched++; console.log('market box now reads GitHub:', p); }
});
walk('site');
fs.mkdirSync('site/data', { recursive: true });
fs.copyFileSync('data/water-oak-market.json', 'site/data/water-oak-market.json');
console.log('pages patched:', patched, '| fallback data copied');
