
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
      found.set(key, { sc: String(sc), garage: det.garage, raw: it });
      if (found.size === 1) console.log('SAMPLE API ITEM:', JSON.stringify(it).slice(0, 4000));
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

// 2. read one listing — API data first, page text fills gaps
function flatten(o, p = '', out = {}) {
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) flatten(v, p ? p + '.' + k : k, out);
  } else out[p] = o;
  return out;
}
function pick(f, re, ok) {
  for (const [k, v] of Object.entries(f)) if (re.test(k) && v != null && v !== '' && (!ok || ok(v))) return v;
  return null;
}
const num = v => { const x = Number(String(v).replace(/[$,]/g, '')); return isNaN(x) ? null : x; };

function parse(key, html, hint) {
  const f = flatten(hint.raw || {});
  const t = html ? text(html) : '';
  const all = (JSON.stringify(hint.raw || {}) + ' ' + t);

  // address
  let address = pick(f, /(address|street)(1|Line1)?$|\.address$|addressLine/i, v => /^\d+\s+\S/.test(String(v)));
  if (!address && html) {
    const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/&amp;/g, '&');
    const seg = title.split(/[>|]/).map(x => x.trim()).find(x => /^\d+\s+\S/.test(x));
    address = seg || (t.match(/(\d{2,5} [A-Za-z0-9 .#'-]+?),\s*Lady Lake/i) || [])[1] || null;
  }
  if (address) address = String(address).replace(/,\s*Lady Lake.*$/i, '').trim();

  // price
  let price = num(pick(f, /(^|\.)(price|listPrice|askingPrice|salePrice|listingPrice)$/i, v => num(v) > 5000 && num(v) < 2000000));
  if (!price && html) price = n((html.match(/price-widget[^>]*>(?:<!---->)?\s*\$?([\d,]+)/) || t.match(/Buy:\s*\$\s*([\d,]+)/) || [])[1]);

  // specs
  let beds = num(pick(f, /bed/i, v => num(v) >= 1 && num(v) <= 6));
  let baths = num(pick(f, /bath/i, v => num(v) >= 1 && num(v) <= 5));
  let sqft = num(pick(f, /sq|square/i, v => num(v) >= 300 && num(v) <= 4000));
  let year = num(pick(f, /year/i, v => num(v) >= 1950 && num(v) <= 2030));
  const bb = t.match(/\b(\d)\s*\/\s*(\d(?:\.\d)?)\s+[\d,]{3,5}\s*Sq\.?\s*Ft/i);
  if (!beds && bb) beds = n(bb[1]);
  if (!baths && bb) baths = n(bb[2]);
  if (!sqft) sqft = n((t.match(/([\d,]{3,5})\s*Sq\.?\s*Ft/i) || [])[1]);
  if (!year) year = n((t.match(/Year(?:\s*Built)?\s*:?\s*((?:19|20)\d{2})/i) || t.match(/\bbuilt in ((?:19|20)\d{2})/i) || [])[1]);
  const lotRent = num(pick(f, /lot.?rent|siteRent/i, v => num(v) > 100 && num(v) < 3000)) || n((t.match(/Lot Rent:\s*\$\s*([\d,]+)/i) || [])[1]);
  const pending = /sale pending|"(?:is)?pending"\s*:\s*true|status"\s*:\s*"[^"]*pending/i.test(all);

  // who's selling it
  const scName = String(pick(f, /salesCenter.*(name|title)/i) || '');
  let source = 'Other';
  if (/foxfire/i.test(scName) || /foxfire/i.test(t)) source = 'Foxfire';
  else if (hint.sc === SUN_KEY || /Water Oak/i.test(scName) || /premier Sun community/i.test(t)) source = 'Sun';

  // parking — true/false flags from the data, otherwise the description
  const words = t.replace(/golf[- ]cart garage/gi, '');
  let parking = 'None';
  if (hint.garage === true || pick(f, /garage/i, v => v === true) || /\bgarage\b/i.test(words)) parking = 'Garage';
  else if (pick(f, /carport/i, v => v === true) || /carport/i.test(t)) parking = 'Carport';
  else if (/golf[- ]cart garage/i.test(t)) parking = 'Cart garage';

  if (!address || !price) { console.log('skipped', key, address ? 'no price' : 'no address'); return null; }
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
  const h = parse(key, html || '', hint);
  if (h) seen[h.address.toLowerCase()] = h;
}
const count = Object.keys(seen).length;
console.log('Water Oak homes saved:', count);

const before = Object.values(db.homes).filter(h => !h.gone).length;
if (count === 0 || (before >= 10 && count < before * 0.5)) {
  console.log('Scan looks incomplete — not marking anything gone this run.');
  process.exit(count === 0 ? 1 : 0);
}

const first = !db.runs.length || db.started === today;
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
