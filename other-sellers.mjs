// "Other sellers" check — every Water Oak home on MHVillage that is NOT sold by
// the Sun sales office or RE/MAX Foxfire (other brokers, dealers, owners).
// Reads data/market.json only to skip homes the market robot already has.
// Writes only data/other_sellers.json.
import fs from 'node:fs';
import { pickOthers, mergeHistory, isTracked } from './others.mjs';

const MHV = 'https://www.mhvillage.com';
const FEED = off => `${MHV}/api/v1/listings.json?offset=${off}&limit=60&order[]=best-match:asc&radius=0&active-sold[]=2&park-key=6059&active[]=1&include[]=detailsStd`;
const FILE = 'data/other_sellers.json';
const today = new Date().toISOString().slice(0, 10);
const HEAD = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8' };

async function get(url, json) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: HEAD }); if (r.ok) return json ? await r.json() : await r.text(); console.log('HTTP', r.status, url); }
    catch (e) { console.log('fetch error', url, e.message); }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}
const text = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

// Read the whole Water Oak feed (MHVillage community 6059). null = not checked.
async function readFeed() {
  const items = [];
  for (let off = 0; off < 600; off += 60) {
    const j = await get(FEED(off), true);
    const list = j && (j.payload || j.data);
    if (!Array.isArray(list)) return null;
    items.push(...list);
    if (list.length < 60) break;
  }
  return items;
}

async function detail(item) {
  const key = String(item.key || item.id);
  const url = `${MHV}/homes/${key}`;
  const sellerKey = String(item.relationships?.salesCenter?.key ?? '');
  const base = { key, url, sellerKey };
  if (isTracked(sellerKey)) return base;               // Sun / Foxfire: no page read needed
  const html = await get(url);
  if (!html) return { ...base, readFailed: true };
  const t = text(html);
  const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/&amp;/g, '&');
  const address = ((title.match(/(\d{1,5} [^|>,]+?),?\s*Lady Lake/i) || t.match(/(\d{1,5} [A-Za-z][A-Za-z0-9 .'-]+?),?\s*Lady Lake/i) || [])[1] || '').trim();
  const price = Number(((html.match(/price-widget[^>]*>(?:<!---->)?\s*\$?([\d,]+)/) || t.match(/Buy:\s*\$\s*([\d,]+)/) || [])[1] || '').replace(/,/g, '')) || null;
  const sellerType = ((t.match(/For Sale By (Owner|Community|Dealer|Agent|Broker|Retailer|Lender|Bank)/) || [])[1]) || null;
  // Owner names are never stored. Businesses are stored by name.
  const seller = sellerType === 'Owner' ? 'Owner'
    : ((t.match(/Listed by:\s*(.{2,80}?)(?:\s+(?:Member of|For Sale By|MHVillage Member|View Our|Follow Us|License))/i) || [])[1] || 'unknown').trim();
  return { ...base, address, price, sellerType, seller, pending: /sale pending/i.test(t) };
}

const items = await readFeed();
let db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { started: today, runs: [], homes: {} };

if (!items || !items.length) {
  console.log('MHVillage could not be read. Recorded as NOT CHECKED. History left unchanged.');
  db.runs.push({ date: today, status: 'not checked', feed: null, others: null });
} else {
  const rows = [];
  for (const it of items) rows.push(await detail(it));
  const failed = rows.filter(r => r.readFailed);
  const market = fs.existsSync('data/market.json') ? JSON.parse(fs.readFileSync('data/market.json', 'utf8')) : { homes: {} };
  const { homes, dropped } = pickOthers(rows.filter(r => !r.readFailed), market);
  for (const d of dropped) console.log('skipped:', d.address || d.key, '-', d.why);
  if (failed.length) {
    // A home page we could not open might be one of the others: don't call anything gone this run.
    console.log(`${failed.length} home pages could not be opened. Counted what was read; gone-clock paused.`);
    mergeHistory(db, homes, today, { clean: false });
    db.runs.push({ date: today, status: 'partial', feed: items.length, others: homes.length, unreadPages: failed.length });
  } else {
    // Only a fully clean read advances the two-miss gone-clock.
    mergeHistory(db, homes, today);
    db.runs.push({ date: today, status: 'ok', feed: items.length, others: homes.length });
  }
  console.log(`MHVillage Water Oak feed: ${items.length} homes | other sellers (not Sun, not Foxfire, not already in market.json): ${homes.length}`);
  for (const h of homes) console.log(` ${h.address} | $${h.price ?? '?'} | ${h.seller} (${h.sellerType ?? '?'})${h.pending ? ' | PENDING' : ''} | ${h.url}`);
}
db.updated = today;
fs.writeFileSync(FILE, JSON.stringify(db, null, 1) + '\n');
