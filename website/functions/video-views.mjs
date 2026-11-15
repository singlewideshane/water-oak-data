// Video view counter for singlewideshane.com.
//   GET  /api/video-views?ids=a,b  -> { "a": 12, "b": 3 }
//   POST /api/video-views?id=a     -> { "views": 13 }
// Counts live in Netlify Blobs store "video-views", one key per video.
// First run copies any counts the earlier counter left in another store.
import { getStore, listStores } from '@netlify/blobs';

const clean = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120);
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const asNum = v => { const n = Number(typeof v === 'object' && v ? (v.views ?? v.count) : v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };

async function migrate(store) {
  if (await store.get('__migrated')) return;
  const found = {};
  try {
    const { stores } = await listStores();
    for (const name of stores || []) {
      if (name === 'video-views') continue;
      const s = getStore(name);
      const { blobs } = await s.list();
      for (const b of blobs || []) {
        const raw = await s.get(b.key);
        let v = raw; try { v = JSON.parse(raw); } catch {}
        if (v && typeof v === 'object' && asNum(v) === null) {
          for (const [k, x] of Object.entries(v)) { const n = asNum(x); if (n !== null) found[clean(k)] = Math.max(found[clean(k)] || 0, n); }
        } else { const n = asNum(v); if (n !== null) found[clean(b.key.split('/').pop())] = Math.max(found[clean(b.key.split('/').pop())] || 0, n); }
      }
    }
  } catch (e) { console.log('migrate skipped', e.message); }
  for (const [k, n] of Object.entries(found)) if (k && !(await store.get(k))) await store.set(k, String(n));
  await store.set('__migrated', new Date().toISOString());
}

export default async req => {
  const url = new URL(req.url);
  const store = getStore({ name: 'video-views', consistency: 'strong' });
  await migrate(store);
  if (req.method === 'POST') {
    const id = clean(url.searchParams.get('id'));
    if (!id) return json({ error: 'id required' }, 400);
    const n = (asNum(await store.get(id)) || 0) + 1;
    await store.set(id, String(n));
    return json({ views: n });
  }
  const ids = String(url.searchParams.get('ids') || '').split(',').map(clean).filter(Boolean).slice(0, 50);
  const out = {};
  for (const id of ids) out[id] = asNum(await store.get(id)) || 0;
  return json(out);
};

export const config = { path: '/api/video-views' };
