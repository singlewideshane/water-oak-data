// Water Oak market robot — Sun sales office (its own MHVillage seller account) + RE/MAX Foxfire
// (read directly in a real headless Chrome), then keeps a running record in data/market.json.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npm i --no-save --no-audit --no-fund playwright', { stdio: 'inherit' });
execSync('npx playwright install --with-deps chromium', { stdio: 'inherit' });
const { chromium } = await import('playwright');

const FOX_BASE = 'https://foxfiremanufactured.com';
const FOX_LIST = FOX_BASE + '/Water-Oak-Country-Club.html';
const FILE = 'data/market.json';
const today = new Date().toISOString().slice(0, 10);
const n = s => s == null ? null : Number(String(s).replace(/[$,\s]/g, '')) || null;

/* ---------- browser ---------- */
const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York'
});
await ctx.route('**/*', r => {
  const u = r.request().url(), t = r.request().resourceType();
  if (['image', 'media', 'font'].includes(t)) return r.abort();
  if (/googletagmanager|google-analytics|doubleclick|facebook|hotjar|clarity\.ms|tiktok|bing\.com|segment|newrelic|optimizely|qualtrics|onetrust|cookielaw|trustarc|adobedtm|demdex|criteo|pinterest|linkedin|twitter|yahoo|taboola|outbrain|adroll|hubspot|intercom|zendesk|livechat|podium|birdeye/i.test(u)) return r.abort();
  return r.continue();
});
const page = await ctx.newPage();

async function open(url, wait = 4000) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(wait);
      return true;
    } catch (e) { console.log('open failed', url, e.message.split('\n')[0]); await page.waitForTimeout(3000); }
  }
  return false;
}
async function loadAll() {
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, 4000); await page.waitForTimeout(700);
    const more = page.locator('button, a').filter({ hasText: /^(load|show|view) more/i }).first();
    if (await more.count() && await more.isVisible().catch(() => false)) { await more.click().catch(() => {}); await page.waitForTimeout(2000); }
  }
}
const bodyText = async () => (await page.locator('body').innerText().catch(() => '')).replace(/\u00a0/g, ' ');

function parking(t) {
  const noCart = t.replace(/golf[- ]?cart garage/gi, '');
  if (/\bgarage\b/i.test(noCart)) return 'Garage';
  if (/carport/i.test(t)) return 'Carport';
  if (/golf[- ]?cart garage/i.test(t)) return 'Cart garage';
  return 'None';
}
function specs(t) {
  const bb = t.match(/(\d)\s*Bed(?:room)?s?\s*\|?\s*(\d(?:\.\d)?)\s*Bath(?:room)?s?\s*\|?\s*([\d,]{3,5})\s*sq/i);
  return {
    beds: bb ? n(bb[1]) : n((t.match(/(\d)\s*(?:Beds?|BR|Bedrooms?)\b/i) || [])[1]),
    baths: bb ? n(bb[2]) : n((t.match(/(\d(?:\.\d)?)\s*(?:Baths?|BA|Bathrooms?)\b/i) || [])[1]),
    sqft: bb ? n(bb[3]) : n((t.match(/([\d,]{3,5})\s*(?:sq\.?\s*ft|sqft|square)/i) || [])[1]),
    year: n((t.match(/(?:Year(?:\s*Built)?|Built)\s*:?\s*((?:19|20)\d{2})/i) || [])[1]),
    parking: parking(t),
    pending: /sale pending|under contract|contract pending/i.test(t)
  };
}

/* ---------- Sun sales office (its own seller account on MHVillage, key 3211 only) ---------- */
const SUN_KEY = '3211';
const MHV = 'https://www.mhvillage.com';
const HEAD = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8' };
async function get(url, json) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: HEAD }); if (r.ok) return json ? await r.json() : await r.text(); console.log('HTTP', r.status, url); }
    catch (e) { console.log('fetch error', url, e.message); }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}
const text = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ');
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

function parseMhv(key, html, hint) {
  const f = flatten(hint.raw || {});
  const t = html ? text(html) : '';
  const all = (JSON.stringify(hint.raw || {}) + ' ' + t);

  const STREET = /^\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Za-z][A-Za-z0-9 .'-]*?\b(?:St|Street|Dr|Drive|Ln|Lane|La|Ct|Court|Cir|Circle|Way|Blvd|Ave|Avenue|Sq|Square|Trl|Trail|Pl|Place|Rd|Road|Hill|Hl|Pt|Point|Ter|Terrace|Loop|Run|Pass|Path)\.?$/i;
  const strVals = Object.values(f).filter(v => typeof v === 'string');
  let address = strVals.map(v => v.trim().replace(/,\s*Lady Lake.*$/i, '')).find(v => STREET.test(v));
  if (!address) address = (t.match(/(\d{1,5} [A-Za-z][A-Za-z0-9 .'-]+?),\s*Lady Lake/i) || [])[1];
  if (!address && html) {
    const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/&amp;/g, '&');
    address = title.split(/[>|]/).map(x => x.trim().replace(/,\s*Lady Lake.*$/i, '')).find(x => STREET.test(x));
  }
  address = address ? String(address).trim() : `Sun listing #${key}`;

  let price = num(pick(f, /(^|\.)(price|listPrice|askingPrice|salePrice|listingPrice)$/i, v => num(v) > 5000 && num(v) < 2000000));
  if (!price && html) price = n((html.match(/price-widget[^>]*>(?:<!---->)?\s*\$?([\d,]+)/) || t.match(/Buy:\s*\$\s*([\d,]+)/) || [])[1]);

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

  const desc = strVals.join(' ') + ' ' + t;
  const words = desc.replace(/golf[- ]?cart garage/gi, '');
  let parking = 'None';
  if (html && /\bgarage\b/i.test(words)) parking = 'Garage';
  else if (html && /carport/i.test(desc)) parking = 'Carport';
  else if (/golf[- ]?cart garage/i.test(desc)) parking = 'Cart garage';

  if (!price) { console.log('skipped', key, 'no price'); return null; }
  return { key, address, source: 'Sun', price, beds, baths, sqft, year, lotRent, parking, pending,
           url: `https://www.mhvillage.com/homes/${key}` };
}

// Read one Sun home's detail page on MHVillage in the real browser (falls back to plain fetch).
// Returns the page text limited to the home's own section, plus the page title.
async function sunDetail(key) {
  const url = `${MHV}/homes/${key}`;
  let title = '', body = '';
  if (await open(url, 3500)) {
    title = await page.title().catch(() => '');
    body = await bodyText();
  }
  if (!/Lady Lake/i.test(title + body)) {
    const html = await get(url);
    if (html) { title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/&amp;/g, '&'); body = text(html); }
  }
  // keep only this home's section: from the address/price block down to the seller box,
  // so site menus, filters and "homes near me" links can't trip the garage/carport check
  let own = body;
  const a = own.search(/About this Home/i);
  const b = own.search(/MOBILE HOMES NEAR ME|Financing Options|Similar Homes|Nearby Homes/i);
  if (a > 0) own = own.slice(Math.max(0, a - 1500), b > a ? b : undefined);
  return { title, body, own };
}

const STRICT = /^\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Za-z][A-Za-z0-9 .'-]*?\b(?:St|Street|Dr|Drive|Ln|Lane|La|Ct|Court|Cir|Circle|Way|Blvd|Ave|Avenue|Sq|Square|Trl|Trail|Pl|Place|Rd|Road|Hill|Hl|Pt|Point|Ter|Terrace|Loop|Lp|Run|Pass|Path)\.?$/i;
const isStreet = a => !!a && STRICT.test(a) && !/\b(mobile|home|homes|sale|for|of|at|located|photo)\b/i.test(a);

function sunAddress(title, body) {
  const fromTitle = title.split(/[>|]/).map(x => x.trim().replace(/,\s*Lady Lake.*$/i, '')).find(isStreet);
  if (fromTitle) return fromTitle;
  for (const m of body.matchAll(/(\d{1,5} [A-Za-z0-9 .'-]{3,35}?),\s*Lady Lake,?\s*FL/gi)) {
    const c = m[1].trim();
    if (isStreet(c)) return c;
  }
  return null;
}

// only the home's own description + details, never the site menus or "homes near me"
function homeSection(t) {
  if (!t) return '';
  const a = t.search(/About this Home/i);
  if (a < 0) return '';
  const rest = t.slice(a);
  const b = rest.search(/MOBILE HOMES NEAR ME|Financing Options|Similar Homes|Nearby Homes/i);
  return b > 0 ? rest.slice(0, b) : rest;
}

function sunParking(t) {
  if (!t || !t.trim()) return 'Unknown';
  const noCart = t.replace(/golf[- ]?cart garage/gi, '');
  if (/\b(?:attached|detached|\d|one|two|single|double)[- ]?car garage\b|\bgarage\b/i.test(noCart)) return 'Garage';
  if (/car ?port/i.test(t)) return 'Carport';
  if (/golf[- ]?cart garage/i.test(t)) return 'Cart garage';
  if (/driveway/i.test(t)) return 'Driveway';
  return 'Unknown';
}

async function scanSun() {
  const items = [];
  for (let off = 0; off < 600; off += 60) {
    const j = await get(`${MHV}/api/v1/listings.json?offset=${off}&limit=60&order[]=best-match:asc&radius=0&active-sold[]=2&park-key=6059&active[]=1&include[]=detailsStd`, true);
    const list = j && (j.payload || j.data || []);
    if (!Array.isArray(list) || !list.length) break;
    items.push(...list);
    if (list.length < 60) break;
  }
  const sunItems = items.filter(it => String(it.relationships?.salesCenter?.key ?? it.salesCenter?.key ?? '') === SUN_KEY);
  console.log('Sun sales office listings found:', sunItems.length, 'of', items.length, 'in the community feed');
  const out = [];
  for (const it of sunItems) {
    const key = String(it.key || it.id);
    const d = await sunDetail(key);
    const html = await get(`${MHV}/homes/${key}`);       // plain page read: this is where the price comes from
    const h = parseMhv(key, html || '', { raw: it });
    if (!h) continue;
    const own = d.own || '';
    const pageText = (d.title || '') + ' ' + (d.body || '') + ' ' + (html ? text(html) : '');
    const addr = sunAddress(d.title, d.body) || sunAddress(html ? ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '') : '', html ? text(html) : '');
    h.address = addr || `Sun listing #${key}`;
    h.parking = sunParking(homeSection(d.body) + ' ' + homeSection(html ? text(html) : ''));
    if (!h.price) h.price = n((own.match(/Buy:\s*\$\s*([\d,]+)/i) || [])[1]);
    if (!h.sqft) h.sqft = n((own.match(/([\d,]{3,5})\s*Sq\.?\s*Ft/i) || [])[1]);
    const yr = pageText.match(/\b((?:19|20)\d{2})\s+[A-Za-z][A-Za-z ]{1,30}?\s+Mobile Home For Sale/i);
    h.year = yr ? n(yr[1]) : null;
    h.pending = /sale pending|under contract|contract pending/i.test(own);
    console.log(` Sun ${key}: ${h.address} | $${h.price} | parking: ${h.parking} | browser read: ${d.body ? 'yes' : 'NO'} | plain read: ${html ? 'yes' : 'NO'}`);
    out.push(h);
  }
  return out;
}

/* ---------- RE/MAX Foxfire ---------- */
async function scanFox() {
  const out = [];
  if (!await open(FOX_LIST, 5000)) return null;
  await loadAll();
  const cards = await page.$$eval("[onclick*='HomedetailCustom'], a[href*='HomedetailCustom']", els => els.map(e => ({
    ref: (e.getAttribute('onclick') || '') + ' ' + (e.getAttribute('href') || ''),
    title: (e.querySelector('h5.card-title, .card-title') || {}).innerText || '',
    price: (e.querySelector('h5.fw-bold, .fw-bold') || {}).innerText || '',
    text: e.innerText || ''
  })));
  const seen = new Map();
  for (const c of cards) { const id = (c.ref.match(/id=(\d+)/i) || [])[1]; if (id && !seen.has(id)) seen.set(id, { ...c, id }); }
  console.log('Foxfire listing cards found:', seen.size);
  for (const c of seen.values()) {
    const url = `${FOX_BASE}/HomedetailCustom.asp?id=${c.id}`;
    const loaded = await open(url, 2500);
    const t = loaded && page.url().includes(c.id) ? await bodyText() : '';
    const address = (c.title || (t.match(/(\d{2,5} [A-Za-z0-9 .#'-]+?(?:St|Street|Dr|Drive|Ln|Lane|Ct|Court|Cir|Circle|Way|Blvd|Ave|Sq|Square|Trl|Pl|Rd|Hl|Hill))\b/i) || [])[1] || '').trim();
    const price = n((c.price.match(/[\d,]{4,}/) || t.match(/\$\s?([\d,]{5,})/) || [])[0]?.replace(/^\$/, ''));
    const h = { source: 'Foxfire', address, price, ...specs(t + ' ' + c.text), url };
    if (h.address && h.price) out.push(h); else console.log('Foxfire: skipped id', c.id);
  }
  return out;
}

const sun = await scanSun().catch(e => { console.log('Sun scan error', e.message); return null; });
const fox = await scanFox().catch(e => { console.log('Foxfire scan error', e.message); return null; });
await browser.close();
console.log('Sun homes:', sun ? sun.length : 'FAILED', '| Foxfire homes:', fox ? fox.length : 'FAILED');
for (const h of [...(sun || []), ...(fox || [])]) console.log(` ${h.source} | ${h.address} | $${h.price} | ${h.beds}/${h.baths} ${h.sqft || '?'}sf ${h.year || ''} ${h.parking}${h.pending ? ' PENDING' : ''}`);

/* ---------- merge with history ---------- */
const keyOf = a => a.toLowerCase().replace(/[.,#]/g, ' ')
  .replace(/\b(drive)\b/g, 'dr').replace(/\b(street)\b/g, 'st').replace(/\b(lane|la)\b/g, 'ln')
  .replace(/\b(circle)\b/g, 'cir').replace(/\b(square)\b/g, 'sq').replace(/\b(court)\b/g, 'ct')
  .replace(/\b(avenue)\b/g, 'ave').replace(/\b(east)\b/g, 'e').replace(/\b(west)\b/g, 'w')
  .replace(/\s+/g, ' ').trim();

let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
if (!db || db.version !== 3) db = { version: 3, started: today, updated: null, runs: [], homes: {} };

const ok = {};
for (const [src, list] of [['Sun', sun], ['Foxfire', fox]]) {
  const prev = Object.values(db.homes).filter(h => h.source === src && !h.gone).length;
  ok[src] = !!list && list.length > 0 && !(prev >= 6 && list.length < prev * 0.5);
  if (!ok[src]) console.log(`${src}: scan looks incomplete, not marking any ${src} homes gone this run.`);
}
if (!ok.Sun && !ok.Foxfire) { console.log('Both scans failed.'); process.exit(1); }

// Clean up Sun homes saved under a listing number or a headline instead of a street address.
// Each is matched to this run by its MHVillage listing number, keeping its first-seen date and price
// history, so a corrected address never makes a home look like it sold.
if (ok.Sun) {
  const oldByKey = {};
  for (const [id, h] of Object.entries(db.homes)) {
    if (h.source === 'Sun' && h.key && !isStreet(h.address)) {
      const prev = oldByKey[h.key];
      if (!prev || (h.firstSeen || '9') < (prev.firstSeen || '9')) oldByKey[h.key] = h;
      delete db.homes[id];
    }
  }
  for (const h of sun) {
    const old = oldByKey[h.key];
    if (!old) continue;
    delete oldByKey[h.key];
    const id = keyOf(h.address);
    if (!db.homes[id]) db.homes[id] = { ...old, gone: false, goneDate: null };
  }
  for (const old of Object.values(oldByKey)) {            // truly no longer listed
    db.homes['sun listing ' + old.key] = { ...old, gone: true, goneDate: old.goneDate || today };
  }
}

const first = !db.runs.length || db.started === today;
const seen = {};
for (const h of [...(ok.Sun ? sun : []), ...(ok.Foxfire ? fox : [])]) {
  const id = keyOf(h.address); seen[id] = true;
  const old = db.homes[id];
  if (!old) db.homes[id] = { ...h, firstSeen: today, lastSeen: today, onAtStart: first, prices: [{ date: today, price: h.price }], gone: false, goneDate: null };
  else {
    const lastP = old.prices[old.prices.length - 1];
    if (!lastP || lastP.price !== h.price) old.prices.push({ date: today, price: h.price });
    Object.assign(old, h, { lastSeen: today, gone: false, goneDate: null });
  }
}
for (const [id, h] of Object.entries(db.homes)) {
  if (!seen[id] && !h.gone && ok[h.source]) { h.gone = true; h.goneDate = today; }
}
db.updated = today;
db.runs.push({ date: today, sun: sun ? sun.length : null, foxfire: fox ? fox.length : null });
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
console.log('saved', FILE, 'for sale now:', Object.values(db.homes).filter(h => !h.gone).length);
