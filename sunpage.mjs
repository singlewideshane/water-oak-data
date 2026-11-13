// Read Sun's own find-a-home page. Pure parsing lives here so a failed
// page read never becomes a list of homes. scrape.mjs decides what to do
// with the result; this file does not touch market.json.
import { keyOf, stripLotSite } from './market.mjs';

const SUN_PAGE = 'https://www.suncommunities.com/florida/water-oak-country-club-estates/find-a-home';
const PENDING = /sale pending|under contract|contract pending/i;

export function sunStreet(raw) {
  return stripLotSite(String(raw ?? '')).split(',')[0].replace(/\s+/g, ' ').trim();
}

function money(s) {
  if (s == null || s === '') return null;
  const x = Number(String(s).replace(/[$,*\s]/g, ''));
  return x > 5000 && x < 2000000 ? x : null;
}

function num(s) {
  if (s == null || s === '') return null;
  const x = Number(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(x) ? x : null;
}

function streetLine(lines) {
  for (const line of lines) {
    if (/^features:/i.test(line)) continue;
    if (/site:\s*#/i.test(line)) continue;
    const cut = String(line).split(',')[0].trim();
    if (/^\d{1,5}\s+[A-Za-z]/.test(cut)) return line;
  }
  return '';
}

// One card from the find-a-home page: street, price, site number, badge.
// Promo badges (Featured, Deal of the Month, site-rent offers) are not pending.
export function parseSunCard(raw) {
  if (!raw) return null;
  const badge = String(raw.badge || '').replace(/\s+/g, ' ').trim();
  const lines = Array.isArray(raw.lines) ? raw.lines : [];
  const spec = lines.find(l => /site:\s*#/i.test(l)) || '';
  const address = sunStreet(streetLine(lines));
  const price = money(raw.price);
  if (!address || !price) return null;
  const site = (spec.match(/site:\s*#?\s*([A-Za-z]+-\d+)/i) || [])[1] || null;
  const home = { source: 'Sun', address, price, pending: PENDING.test(badge) };
  if (raw.href) home.url = raw.href;
  if (site) home.site = site.toUpperCase();
  const beds = num((spec.match(/(\d+)\s*beds?/i) || [])[1]);
  const baths = num((spec.match(/(\d+(?:\.\d+)?)\s*baths?/i) || [])[1]);
  const sqft = num((spec.match(/([\d,]+)\s*sq\.?\s*ft/i) || [])[1]);
  if (beds) home.beds = beds;
  if (baths) home.baths = baths;
  if (sqft) home.sqft = sqft;
  return home;
}

// The page repeats a few cards in the DOM. The control is unique homes
// against the stated "N Homes Found" total, not the raw node count.
export function acceptSunRead(stated, rawCards) {
  const parsed = [];
  for (const raw of rawCards || []) {
    const home = parseSunCard(raw);
    if (home) parsed.push(home);
  }
  const by = new Map();
  for (const h of parsed) {
    const id = String(h.site || keyOf(h.address)).toLowerCase();
    const prev = by.get(id);
    if (!prev) by.set(id, h);
    else if (h.pending && !prev.pending) prev.pending = true;
  }
  const homes = [...by.values()];
  const nodes = (rawCards || []).length;
  if (stated == null || !Number.isFinite(stated)) {
    return { ok: false, homes: [], stated: null, nodes, reason: 'could not read Sun website (no Homes Found total)' };
  }
  if (homes.length !== stated) {
    const noun = homes.length === 1 ? 'card' : 'cards';
    return {
      ok: false, homes: [], stated, nodes,
      reason: `Sun page says ${stated} Homes Found but ${homes.length} ${noun} loaded (${nodes} card nodes)`
    };
  }
  return { ok: true, homes, stated, nodes, reason: '' };
}

function failed(reason) {
  return { ok: false, homes: [], stated: null, nodes: 0, reason };
}

async function statedTotal(page) {
  const t = (await page.locator('body').innerText().catch(() => '')).replace(/\u00a0/g, ' ');
  if (/access denied/i.test(t) && !/homes?\s+found/i.test(t)) return { denied: true, stated: null };
  const m = t.match(/(\d+)\s+Homes?\s+found/i);
  return { denied: false, stated: m ? Number(m[1]) : null };
}

// Click View More Homes until the button is gone, then require the unique
// cards to equal the page's own total. Anything short of that is a failed read.
export async function readSunPage(page) {
  let res;
  try {
    res = await page.goto(SUN_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    return failed('could not read Sun website (' + e.message.split('\n')[0] + ')');
  }
  if (res && res.status() >= 400) return failed('could not read Sun website (HTTP ' + res.status() + ')');

  let stated = null;
  for (let i = 0; i < 20 && stated == null; i++) {
    const got = await statedTotal(page);
    if (got.denied) return failed('could not read Sun website (access denied)');
    stated = got.stated;
    if (stated == null) await page.waitForTimeout(1000);
  }
  if (stated == null) return failed('could not read Sun website (no Homes Found total)');

  for (let i = 0; i < 12; i++) {
    const more = page.locator('button, a').filter({ hasText: /view more homes/i });
    const n = await more.count();
    let clicked = false;
    for (let j = 0; j < n; j++) {
      const el = more.nth(j);
      if (await el.isVisible().catch(() => false)) {
        await el.click({ timeout: 5000 }).catch(() => {});
        clicked = true;
        await page.waitForTimeout(1200);
        break;
      }
    }
    if (!clicked) break;
  }

  const again = await statedTotal(page);
  if (again.denied) return failed('could not read Sun website (access denied)');
  if (again.stated != null) stated = again.stated;

  const raw = await page.$$eval('.community-card', els => els.map(el => ({
    badge: [...el.querySelectorAll('.special-offers-container button')]
      .map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' '),
    price: ((el.querySelector('h3') || {}).innerText || '').trim(),
    lines: [...el.querySelectorAll('p')].map(p => (p.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    href: (el.querySelector('a[href*="/florida/"]') || {}).href || ''
  })));
  const result = acceptSunRead(stated, raw);
  if (result.ok) {
    const pending = result.homes.filter(h => h.pending).length;
    console.log(`Sun page: ${stated} Homes Found, ${raw.length} card nodes, ${result.homes.length} unique, ${pending} pending`);
  }
  return result;
}
