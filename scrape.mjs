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
  if (!year) year = n((t.match(/Year(?:\s*Built)?\s*:?\s*((?:19|20)\d{2})/i) || t.match(/\bbuilt in ((?:19|20)\d{2})/i)
