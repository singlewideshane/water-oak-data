// Pulls every Water Oak listing (Sun sales office + RE/MAX Foxfire) from MHVillage,
// compares to last week, and keeps a running record in data/market.json.
import fs from 'node:fs';

const PARK = 6059;
const SUN_KEY = '3211';
const BASE = 'https://www.mhvillage.com';
const FILE = 'data/market.json';
const HEAD = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};
const today = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, json) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: HEAD });
      if (r.ok) return json ? await r.json() : await r.text();
      console.log('HTTP', r.status, url);
    } catch (e) { console.log('fetch error', url, e.message); }
    await sleep(2000 * (i + 1));
  }
  return null;
}

// 1. find every active listing key in the community
async function listingKeys() {
  const found = new Map(); // key -> salesCenter key (if known)
  for (let off = 0; off < 600; off += 60) {
    const url = `${BASE}/api/v1/listings.json?offset=${off}&limit=60&order[]=best-match:asc&radius=0&active-sold[]=2&park-key=${PARK}&active[]=1&include[]=detailsStd`;
    const j = await get(url, true);
    const items = j && (j.payload || j.data || []);
    if (!Array.isArray(items) || !items.length) break;
    for (const it of items) {
      const key = String(it.key || it.id || '');
      if (!key) continue;
      const sc = it.relationships?.salesCenter?.key ?? it.salesCenter?.key ?? '';
      const det = it.relationships?.detailsStd || it.detailsStd || {};
      found.set(key, { sc: String(sc), garage: det.garage });
    }
    if (items.length < 60) break;
    await sleep(800);
  }
  if (!found.size) {
    // fallback: read links off the community page
    for (const path of [`/parks/${PARK}`, `/parks/${PARK}/homes`]) {
      const html = await get(BASE + path);
      if (!html) continue;
      for (const m of html.matchAll(/\/homes\/(\d{6,9})/g)) if (!found.has(m[1])) found.set(m[1], {});
    }
  }
  return found;
}

const text = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ');
const n = s => s == null ? null : Number(String(s).replace(/,/g, ''));

// 2. read one listing page
function parse(key, html, hint) {
  const t = text(html);
  if (!/Water Oak/i.test(t)) return null;

  let source = null;
  if (/foxfire/i.test(t)) source = 'Foxfire';
  else if (hint.sc === SUN_KEY || /Listed by:?\s*Water Oak Country Club Estates/i.test(t)) source = 'Sun';
  if (hint.sc && hint.sc !== SUN_KEY && !/foxfire/i.test(t)) source = null;
  if (!source) return null;

  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const address = ((title.match(/\|\s*([^|]+?),\s*Lady Lake/i) || t.match(/(\d{2,5} [A-Za-z0-9 .#'-]+?),\s*Lady Lake/i) || [])[1] || '').trim();

  const price = n((html.match(/price-widget[^>]*>(?:<!---->)?\s*\$?([\d,]+)/) || t.match(/Buy:\s*\$\s*([\d,]+)/) || [])[1]);
  const bb = t.match(/\b(\d)\s*\/\s*(\d(?:\.\d)?)\s+[\d,]{3,5}\s*Sq\.?\s*Ft/i);
  const sqft = n((t.match(/([\d,]{3,5})\s*Sq\.?\s*Ft/i) || [])[1]);
  const beds = bb ? n(bb[1]) : n((t.match(/(\d)\s*-?\s*bed(?:room)?s?\b/i) || [])[1]);
  const baths = bb ? n(bb[2]) : n((t.match(/(\d(?:\.\d)?)\s*-?\s*bath(?:room)?s?\b/i) || [])[1]);
  const year = n((t.match(/Year(?:\s*Built)?\s*:?\s*((?:19|20)\d{2})/i) || t.match(/\bbuilt in ((?:19|20)\d{2})/i) || [])[1]);
  const lotRent = n((t.match(/Lot Rent:\s*\$\s*([\d,]+)/i) || [])[1]);
  const pending = /Sale Pending/i.test(t);

  const noCart = t.replace(/golf[- ]cart garage/gi, '');
  let parking = 'None';
  if (hint.garage === true || /\b(attached|\d[- ]car|car|oversized|detached)\s+garage\b|\bgarage\b/i.test(noCart)) parking = 'Garage';
  else if (/carport/i.test(t)) parking = 'Carport';
  else if (/golf[- ]cart garage/i.test(t)) parking = 'Cart garage';

  if (!address || !price) return null;
  return { key, address, source, price, beds, baths, sqft, year, lotRent, parking, pending,
           url: `${BASE}/homes/${key}` };
}

// 3. merge with history
const db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8'))
  : { started: today, updated: null, runs: [], homes: {} };

const keys = await listingKeys();
console.log('listing keys found:', keys.size);
const seen = {};
for (const [key, hint] of keys) {
  const html = await get(`${BASE}/homes/${key}`);
  await sleep(700);
  if (!html) continue;
  const h = parse(key, html, hint);
  if (h) seen[h.address.toLowerCase()] = h;
}
const count = Object.keys(seen).length;
console.log('Water Oak homes (Sun + Foxfire):', count);

const before = Object.values(db.homes).filter(h => !h.gone).length;
if (count === 0 || (before >= 10 && count < before * 0.5)) {
  console.log('Scan looks incomplete — not marking anything gone this run.');
  process.exit(count === 0 ? 1 : 0);
}

const first = !db.runs.length;
for (const [id, h] of Object.entries(seen)) {
  const old = db.homes[id];
  if (!old) {
    db.homes[id] = { ...h, firstSeen: today, lastSeen: today, onAtStart: first,
                     prices: [{ date: today, price: h.price }], gone: false, goneDate: null };
  } else {
    const lastP = old.prices[old.prices.length - 1];
    if (!lastP || lastP.price !== h.price) old.prices.push({ date: today, price: h.price });
    Object.assign(old, h, { lastSeen: today, gone: false, goneDate: null });
  }
}
for (const [id, h] of Object.entries(db.homes)) {
  if (!seen[id] && !h.gone) { h.gone = true; h.goneDate = today; }
}
db.updated = today;
db.runs.push({ date: today, count });
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
console.log('saved', FILE);
