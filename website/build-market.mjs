// Builds data/water-oak-market.json for singlewideshane.com — same fields the
// site already reads. Sources: data/market.json (Sun + RE/MAX Foxfire),
// data/other_sellers.json (other MHVillage sellers), data/stats.json (Shane's
// own listings) and data/fsbo_manual.csv (owner listings Shane logs by hand).
// Each home is counted once. Writes only data/water-oak-market.json and
// website/history.json (last snapshot, for "what's moving").
import fs from 'node:fs';
import { matchKey } from '../others.mjs';

const today = new Date().toISOString().slice(0, 10);
const read = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d;

export function csvRows(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const split = line => { const out = []; let cur = '', q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map(s => s.trim()); };
  const head = split(lines[0]).map(h => h.toLowerCase());
  return lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

// All sources -> one row per home. First source to name a home wins its price;
// pending anywhere makes the home pending.
export function collect({ market, others, stats, manual, live }) {
  const homes = new Map();
  const add = (address, price, pending, source) => {
    if (!address) return;
    const k = matchKey(address);
    if (!/^\d/.test(k)) return;
    const h = homes.get(k);
    if (!h) homes.set(k, { key: k, address, price: price || null, pending: !!pending, source });
    else { if (pending) h.pending = true; if (!h.price && price) h.price = price; }
  };
  // Sun: use the market robot's Sun list only if its last good Sun read is at least as new as
  // MHVillage's Sun list; otherwise use MHVillage's Sun sales-office list (fresher).
  const lastSun = [...(market?.runs || [])].reverse().find(r => r.sun != null)?.date || '';
  const mhvSun = others?.sunOnMhv;
  const useMhvSun = !!(mhvSun?.homes?.length && mhvSun.date > lastSun);
  for (const h of Object.values(market?.homes || {})) {
    if (h.gone || (useMhvSun && h.source === 'Sun')) continue;
    add(h.address, h.price, h.pending, h.source);
  }
  if (useMhvSun) for (const h of mhvSun.homes) add(h.address, h.price, h.pending, 'Sun');
  for (const h of Object.values(others?.homes || {})) if (!h.gone) add(h.address, h.price, h.status === 'pending', 'MHVillage');
  for (const a of others?.pendingOnMhv?.addresses || []) { const h = homes.get(matchKey(a)); if (h) h.pending = true; else add(a, null, true, 'MHVillage'); }
  for (const l of stats?.listings || []) {
    if (!['active', 'pending'].includes(String(l.status).toLowerCase())) continue;
    const ph = l.priceHistory || [];
    add(l.address, ph.length ? ph[ph.length - 1].price : l.listPrice, String(l.status).toLowerCase() === 'pending', 'Shane');
  }
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  for (const r of manual || []) {
    const st = String(r.status || 'active').toLowerCase();
    if (r.date_seen && r.date_seen < cutoff) continue;   // not re-confirmed in 30 days: left out
    if (!['active', 'pending'].includes(st)) continue;
    add(r.address, Number(String(r.price || '').replace(/[$,]/g, '')) || null, st === 'pending', r.source || 'Manual');
  }
  // Weekly live check (Shane's browser): valid 8 days. Adds owner listings and pending tags
  // the robot can't see (Sun's own site, Zillow, Facebook).
  if (live?.date && (Date.now() - Date.parse(live.date)) / 86400000 <= 8) {
    for (const h of live.owner_active || []) add(h.address, h.price, false, h.source || 'Owner');
    for (const a of live.pending || []) { const h = homes.get(matchKey(a)); if (h) h.pending = true; else add(a, null, true, 'Live check'); }
  }
  return [...homes.values()];
}

const BANDS = [['Under $60K', 0, 60000], ['$60K–$80K', 60000, 80000], ['$80K–$100K', 80000, 100000],
  ['$100K–$150K', 100000, 150000], ['$150K+', 150000, Infinity]];
const range = ps => ps.length ? [Math.min(...ps), Math.max(...ps)] : [0, 0];

export function build(homes, prev, date) {
  const forSale = homes.filter(h => !h.pending);
  const pending = homes.filter(h => h.pending);
  const priced = forSale.map(h => h.price).filter(p => p > 0).sort((a, b) => a - b);
  const mid = priced.length ? (priced.length % 2 ? priced[(priced.length - 1) / 2]
    : Math.round((priced[priced.length / 2 - 1] + priced[priced.length / 2]) / 2)) : 0;
  const bands = BANDS.map(([band, lo, hi]) => ({ band, count: priced.filter(p => p >= lo && p < hi).length }));
  const top = bands.reduce((a, b) => b.count > a.count ? b : a, bands[0]);
  const missing = forSale.length - priced.length;

  const before = prev?.homes || {};
  const nowByKey = Object.fromEntries(homes.map(h => [h.key, h]));
  const wentPending = Object.entries(before).filter(([k, h]) => !h.pending && nowByKey[k]?.pending).map(([k]) => nowByKey[k].price).filter(Boolean);
  const left = Object.entries(before).filter(([k, h]) => !nowByKey[k] && !h.pending).map(([, h]) => h.price).filter(Boolean);
  const leftCount = Object.entries(before).filter(([k, h]) => !nowByKey[k] && !h.pending).length;
  const pendCount = Object.entries(before).filter(([k, h]) => !h.pending && nowByKey[k]?.pending).length;

  return {
    updated: date,
    total_for_sale: forSale.length,
    total_for_sale_explainer: 'Active homes for sale in Water Oak from every source — the sales office, brokerages, and for-sale-by-owner listings — with pending sales removed and each home counted once.',
    pending_or_under_contract: pending.length,
    stats_basis: missing
      ? `Median, price range and price bands use ${priced.length} of the ${forSale.length} homes for sale (${missing === 1 ? 'one listing shows' : missing + ' listings show'} no asking price).`
      : `Median, price range and price bands use all ${forSale.length} homes for sale.`,
    median_ask: mid,
    price_range: range(priced),
    price_bands: bands,
    whats_moving: { since: prev?.date || date, went_pending_count: pendCount, went_pending_range: range(wentPending),
      left_list_count: leftCount, left_list_range: range(left) },
    takeaway: `The most common price range in Water Oak right now is ${top.band} (${top.count} of ${forSale.length} homes).`
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const market = read('data/market.json', null);
  const others = read('data/other_sellers.json', { homes: {} });
  if (!market || !Object.keys(market.homes || {}).length) { console.log('market.json missing or empty — website file left unchanged.'); process.exit(0); }
  const stats = read('data/stats.json', { listings: [] });
  const manual = fs.existsSync('data/fsbo_manual.csv') ? csvRows(fs.readFileSync('data/fsbo_manual.csv', 'utf8')) : [];
  const live = read('data/live_check.json', null);
  const homes = collect({ market, others, stats, manual, live });
  const prev = read('website/history.json', null);
  const out = build(homes, prev, today);
  fs.writeFileSync('data/water-oak-market.json', JSON.stringify(out, null, 1) + '\n');
  fs.writeFileSync('website/history.json', JSON.stringify({ date: today,
    homes: Object.fromEntries(homes.map(h => [h.key, { address: h.address, price: h.price, pending: h.pending, source: h.source }])) }, null, 1) + '\n');
  console.log(`Website market file: ${out.total_for_sale} for sale, ${out.pending_or_under_contract} pending, median $${out.median_ask}`);
}
