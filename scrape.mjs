// Water Oak market robot — reads the Sun sales office site and RE/MAX Foxfire
// directly in a real (headless) Chrome, then keeps a running record in data/market.json.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npm i --no-save --no-audit --no-fund playwright', { stdio: 'inherit' });
execSync('npx playwright install --with-deps chromium', { stdio: 'inherit' });
const { chromium } = await import('playwright');

const SUN_LIST = 'https://www.suncommunities.com/florida/water-oak-country-club-estates/find-a-home';
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
// skip the tracking/ad scripts that freeze the Sun site, plus images
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

/* ---------- Sun sales office ---------- */
async function scanSun() {
  const out = [];
  if (!await open(SUN_LIST, 8000)) return null;
  await loadAll();
  const links = await page.$$eval('a[href]', as => as.map(a => {
    const card = a.closest('[class*="card"], li, article') || a.parentElement;
    return { href: a.href, text: (card ? card.innerText : a.innerText) || '' };
  }));
  const seen = new Map();
  for (const l of links) {
    const m = l.href.match(/water-oak-country-club-estates\/(\d+)-([a-z0-9-]+?)-32159/i);
    if (m && !seen.has(m[1])) seen.set(m[1], { ...l, id: m[1], slug: m[2] });
  }
  console.log('Sun listing links found:', seen.size);
  for (const l of seen.values()) {
    await open(l.href, 3500);
    const t = await bodyText();
    let address = (t.match(/Address:\s*([^,\n]+?)\s*,\s*Lady Lake/i) || [])[1];
    if (!address) address = l.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const price = n((t.match(/Sales Price\s*\$?\s*([\d,]{4,})/i) || t.match(/\$\s?([\d,]{5,})(?!\s*\/\s*mo)/) || l.text.match(/\$\s?([\d,]{5,})/) || [])[1]);
    const h = { source: 'Sun', address: address.trim(), price, ...specs(t + ' ' + l.text), url: l.href };
    if (h.price) out.push(h); else console.log('Sun: no price for', h.address);
  }
  return out;
}

/* ---------- RE/MAX Foxfire ---------- */
async function scanFox() {
  const out = [];
  if (!await open(FOX_LIST, 5000)) return null;
  await loadAll();
  let cards = await page.$$eval("[onclick*='HomedetailCustom'], a[href*='HomedetailCustom']", els => els.map(e => ({
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
    await open(url, 2500);
    const t = await bodyText();
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
  .replace(/\s+\d{3,5}$/, '').replace(/\s+/g, ' ').trim();

let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
if (!db || db.version !== 2) db = { version: 2, started: today, updated: null, runs: [], homes: {} };

const ok = {};
for (const [src, list] of [['Sun', sun], ['Foxfire', fox]]) {
  const prev = Object.values(db.homes).filter(h => h.source === src && !h.gone).length;
  ok[src] = !!list && list.length > 0 && !(prev >= 6 && list.length < prev * 0.5);
  if (!ok[src]) console.log(`${src}: scan looks incomplete — not marking any ${src} homes gone this run.`);
}
if (!ok.Sun && !ok.Foxfire) { console.log('Both scans failed.'); process.exit(1); }

const first = !db.runs.length;
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
console.log('saved', FILE, '— for sale now:', Object.values(db.homes).filter(h => !h.gone).length);
