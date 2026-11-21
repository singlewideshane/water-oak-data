// One-time (re-runnable) copy of the LIVE Listings app from Netlify into app/src.
// Reads only. Exits non-zero if any file fails, so a partial copy is never committed.
import fs from 'node:fs';
import path from 'node:path';

const SITE_ID = '096f9065-4006-4148-a47b-a65ee3ff88c1'; // lambent-bublanina-a695d4
const ORIGIN = 'https://lambent-bublanina-a695d4.netlify.app';
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
if (!TOKEN) { console.log('NETLIFY_AUTH_TOKEN secret is missing.'); process.exit(1); }

const api = await fetch(`https://api.netlify.com/api/v1/sites/${SITE_ID}/files`, { headers: { Authorization: `Bearer ${TOKEN}` } });
if (!api.ok) { console.log('Netlify file list failed', api.status); process.exit(1); }
const files = await api.json();
console.log('Live app files:', files.length);
const OUT = 'app/src';
fs.rmSync(OUT, { recursive: true, force: true });
let failed = 0;
for (const f of files) {
  const rel = f.path.replace(/^\/+/, '');
  if (!rel || rel.startsWith('.netlify')) continue;
  const enc = rel.split('/').map(encodeURIComponent).join('/');
  let buf = null;
  const r = await fetch(`${ORIGIN}/${enc}`, { redirect: 'manual' });
  if (r.ok) buf = Buffer.from(await r.arrayBuffer());
  else {
    const a = await fetch(`https://api.netlify.com/api/v1/deploys/${f.deploy_id}/files/${enc}`,
      { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.bitballoon.v1.raw' } });
    if (a.ok) buf = Buffer.from(await a.arrayBuffer());
  }
  if (!buf) { console.log('FAILED', rel); failed++; continue; }
  fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
  fs.writeFileSync(path.join(OUT, rel), buf);
  console.log('ok', rel, buf.length);
}
if (failed) process.exit(1);
