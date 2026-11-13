// VERSION 8 — A HOME IS GONE ONLY AFTER TWO CLEAN MISSES (Nov 7). If you see this line on GitHub, the right code is saved.

// Water Oak market robot — Sun's own website (headless Chrome) + RE/MAX Foxfire,
// then a running record in data/market.json. A failed or short Sun read leaves
// the saved Sun homes alone and does not use MHVillage.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { keyOf, sourceStatus, recordSeen, repeatedCuts } from './market.mjs';
import { readSunPage } from './sunpage.mjs';

execSync('npm i --no-save --no-audit --no-fund playwright', { stdio: 'inherit' });
const { chromium } = await import('playwright');

const FOX_BASE = 'https://foxfiremanufactured.com';
const FOX_LIST = FOX_BASE + '/Water-Oak-Country-Club.html';
const FILE = 'data/market.json';
const today = new Date().toISOString().slice(0, 10);
const n = s => s == null ? null : Number(String(s).replace(/[$,\s]/g, '')) || null;

/* ---------- browser ---------- */
// Akamai answers Playwright's bundled Chromium with HTTP 403. Installed
// Google Chrome, with an ordinary browser user-agent, can read the page.
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
});
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York'
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
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
  if (/driveway/i.test(t)) return 'Driveway';
  return 'None';
}
function specs(t) {
  const bb = t.match(/(\d)\s*Bed(?:room)?s?\s*\|?\s*(\d(?:\.\d)?)\s*Bath(?:room)?s?\s*\|?\s*([\d,]{3,5})\s*sq/i);
  return {
    beds: bb ? n(bb[1]) : n((t.match(/(\d)\s*(?:Beds?|BR|Bedrooms?)\b/i) || [])[1]),
    baths: bb ? n(bb[2]) : n((t.match(/(\d(?:\.\d)?)\s*(?:Baths?|BA|Bathrooms?)\b/i) || [])[1]),
    sqft: bb ? n(bb[3]) : n((t.match(/([\d,]{3,5})\s*(?:sq\.?\s*ft|sqft|square)/i) || [])[1]),
    year: n((t.match(/(?:Year(?:\s*Built)?|Built)\s*(?:in)?\s*:?\s*((?:19|20)\d{2})/i) || [])[1]),
    parking: parking(t),
    pending: /sale pending|under contract|contract pending/i.test(t)
  };
}

const STRICT = /^\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Za-z][A-Za-z0-9 .'-]*?\b(?:St|Street|Dr|Drive|Ln|Lane|La|Ct|Court|Cir|Circle|Way|Blvd|Ave|Avenue|Sq|Square|Trl|Trail|Pl|Place|Rd|Road|Hill|Hl|Pt|Point|Ter|Terrace|Loop|Lp|Run|Pass|Path)\.?$/i;
const isStreet = a => !!a && STRICT.test(a) && !/\b(mobile|home|homes|sale|for|of|at|located|photo)\b/i.test(a);

// Sun's own page, in its own tab and with a time limit, so a hang still
// leaves Foxfire able to finish. A miss here is a failed read: null, not a
// shorter list and not an MHVillage substitute.
async function scanSun() {
  const tab = await ctx.newPage();
  const job = readSunPage(tab).catch(e => ({
    ok: false, homes: [], stated: null,
    reason: 'could not read Sun website (' + e.message.split('\n')[0] + ')'
  }));
  const limit = new Promise(resolve => setTimeout(() => resolve({
    ok: false, homes: [], stated: null,
    reason: 'could not read Sun website (timed out)'
  }), 120000));
  const res = await Promise.race([job, limit]);
  await tab.close().catch(() => {});
  return res;
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

const sunRead = await scanSun();
const fox = await scanFox().catch(e => { console.log('Foxfire scan error', e.message); return null; });
let sun = null;
let sunCheck = 'could not read Sun website';
if (sunRead.ok) {
  sun = sunRead.homes;
  sunCheck = 'match';
  const pending = sun.filter(h => h.pending).length;
  console.log(`Sun website: ${sunRead.stated} Homes Found | ${sun.length} loaded | ${pending} pending | ${sun.length - pending} active`);
} else {
  console.log('SUN READ FAILED:', sunRead.reason);
  console.log('Previous Sun homes left unchanged. Not using MHVillage.');
  sunCheck = sunRead.reason || sunCheck;
}
await browser.close();
console.log('Sun homes:', sun ? sun.length : 'FAILED', '| Foxfire homes:', fox ? fox.length : 'FAILED');
for (const h of [...(sun || []), ...(fox || [])]) console.log(` ${h.source} | ${h.address} | $${h.price} | ${h.beds}/${h.baths} ${h.sqft || '?'}sf ${h.year || ''} ${h.parking}${h.pending ? ' PENDING' : ''}`);

/* ---------- merge with history ---------- */
let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
if (!db || db.version !== 3) db = { version: 3, started: today, updated: null, runs: [], homes: {} };

const ok = sourceStatus(db, sun, fox);
for (const src of ['Sun', 'Foxfire']) {
  if (!ok[src]) console.log(`${src}: scan looks incomplete, not marking any ${src} homes gone this run (gone-clock paused).`);
}
if (!ok.Sun && !ok.Foxfire) { console.log('Both scans failed.'); process.exit(1); }

// Clean up Sun homes saved under a listing number or a headline instead of a street address.
// Each is matched to this run by its MHVillage listing number, keeping its first-seen date and price
// history, so a corrected address never makes a home look like it sold.
// This repair is not the feed gone-clock: an unmatched key is still closed on this one clean Sun pull.
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

recordSeen(db, { today, sun, fox, ok });
db.updated = today;
db.runs.push({ date: today, sun: sun ? sun.length : null, foxfire: fox ? fox.length : null,
  sunWebsite: sunRead.stated != null ? sunRead.stated : null, sunCheck });
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
console.log('saved', FILE, 'for sale now:', Object.values(db.homes).filter(h => !h.gone).length);

const cuts = repeatedCuts(db.homes, today);
fs.writeFileSync('data/repeated_cuts.json', JSON.stringify(cuts, null, 1) + '\n');
console.log('data/repeated_cuts.json:', cuts.length, 'homes cut twice within 60 days');

/* ---------- handoff to list-to-sold ----------
   Every home the robot has seen disappear, that the list-to-sold files don't cover yet,
   goes into list-to-sold/to_check.csv. Rebuilt each run, so a home drops off once it is
   added to master_sales.csv, gaps.csv or sun/sun_exits_2026.csv. */
{
  const csvAddrs = (file, col) => {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(line => {
      const cells = []; let cur = '', q = false;
      for (const ch of line) {
        if (ch === '"') q = !q; else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
      }
      cells.push(cur);
      return cells[col] || '';
    });
  };
  const covered = new Set([
    ...csvAddrs('list-to-sold/master_sales.csv', 0),
    ...csvAddrs('list-to-sold/gaps.csv', 1),
    ...csvAddrs('list-to-sold/sun/sun_exits_2026.csv', 0),
  ].map(keyOf));
  const esc = v => v == null ? '' : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = Object.values(db.homes)
    .filter(h => h.gone && !covered.has(keyOf(h.address || '')))
    .sort((a, b) => (b.goneDate || '').localeCompare(a.goneDate || ''))
    .map(h => [h.address, h.source, h.goneDate, h.price, h.prices && h.prices[0] ? h.prices[0].price : '', h.firstSeen, h.url].map(esc).join(','));
  fs.writeFileSync('list-to-sold/to_check.csv',
    'address,source,gone_date,last_ask,first_ask_seen,first_seen,url\n' + rows.join('\n') + (rows.length ? '\n' : ''));
  console.log('list-to-sold/to_check.csv:', rows.length, 'gone homes not yet in list-to-sold');
}
