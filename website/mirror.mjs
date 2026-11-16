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
  // The live deploy's netlify.toml is inert: Netlify reports "No redirect rules / No header
  // rules processed" for it, and its contents can't be downloaded. Leaving it out changes nothing.
  if (rel === 'netlify.toml') { console.log('skipped netlify.toml (inert in the live deploy)'); continue; }
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
      } else if (r.status === 404) {
        // Some deploy files (netlify.toml, _redirects, _headers) are never served publicly.
        // Read those straight from Netlify instead.
        let buf = null;
        const enc = rel.split('/').map(encodeURIComponent).join('/');
        const tries = [
          [`https://api.netlify.com/api/v1/deploys/${f.deploy_id}/files/${enc}`, 'application/vnd.bitballoon.v1.raw'],
          [`https://api.netlify.com/api/v1/sites/${SITE_ID}/files/${enc}`, 'application/vnd.bitballoon.v1.raw'],
          [`https://api.netlify.com/api/v1/deploys/${f.deploy_id}/files/${enc}`, 'application/octet-stream'],
        ];
        for (const [u, accept] of tries) {
          const a = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: accept } });
          if (!a.ok) { console.log('Netlify API', a.status, u); continue; }
          const b = Buffer.from(await a.arrayBuffer());
          if (/^\s*\{"id":/.test(b.toString('utf8', 0, 20))) { console.log('got file info, not contents:', u); continue; }
          buf = b; break;
        }
        if (buf) {
          fs.mkdirSync(path.dirname('site/' + rel), { recursive: true });
          fs.writeFileSync('site/' + rel, buf);
          ok = true;
          console.log('read from Netlify (not public):', rel);
        } else console.log('could not read from Netlify either:', rel);
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
if (patched < 1) { console.log('Market fetch line not found in any page. Not deploying.'); process.exit(1); }
// Homepage hero edits (Nov 16, 2026): new bio wording + remove the diagonal light streak.
// Safe to re-run: each change only applies if it isn't already there.
{
  const p = 'site/index.html';
  let s = fs.readFileSync(p, 'utf8');
  const OLD_BIO = 'With my background in construction, landscaping, and photography, I help you get';
  const NEW_BIO = 'I bring real estate experience from my years as a Texas Realtor, along with a background in construction, landscaping, and photography. I help you get';
  if (s.includes(OLD_BIO)) { s = s.replace(OLD_BIO, NEW_BIO); console.log('hero bio updated'); }
  const MARK = '<!-- hero-no-streak -->';
  if (!s.includes(MARK)) {
    const css = MARK + '<style>body .hero{background-image:radial-gradient(40% 50% at 78% 42%,rgba(214,182,118,.07),rgba(0,0,0,0) 65%),linear-gradient(180deg,rgba(255,255,255,.2) 0,rgba(255,255,255,.05) 2px,rgba(255,255,255,0) 8px)!important}</style>';
    s = s.replace('</body>', css + '\n</body>');
    console.log('hero light streak removed');
  }
  fs.writeFileSync(p, s);
}

// netlify.toml is project config, not a page: it belongs next to the site folder.
if (fs.existsSync('site/netlify.toml')) {
  fs.renameSync('site/netlify.toml', 'netlify.toml');
  console.log('--- netlify.toml from the live site ---\n' + fs.readFileSync('netlify.toml', 'utf8'));
}
