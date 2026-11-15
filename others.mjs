// "Other sellers" check — pure helpers. No network, no files.
// Used by other-sellers.mjs. Does not touch data/market.json.
import { keyOf } from './market.mjs';

export const SUN_KEY = '3211';      // Sun sales office's MHVillage seller account
export const FOXFIRE_KEY = '23986'; // RE/MAX Foxfire agents' MHVillage seller account (confirmed Nov 15, 2026)
const TRACKED = new Set([SUN_KEY, FOXFIRE_KEY]);

const SUFFIX = /\b(?:st|dr|ln|la|ct|cir|way|blvd|ave|sq|trl|trail|pl|rd|road|hill|hl|pt|ter|loop|lp|run|pass|path)$/;

// Loose match: house number + street name, with the street type removed,
// so "735 Sutton", "735 Sutton St" and "735 Sutton Street Lot 2504" are one home.
// keyOf already removes Lot/Site numbers, punctuation and spells out
// Drive/Dr, Street/St, Lane/La/Ln, East/E, etc. the same way.
export function matchKey(address) {
  let k = keyOf(address);
  for (let i = 0; i < 2 && SUFFIX.test(k); i++) k = k.replace(SUFFIX, '').trim();
  return k;
}

export const isTracked = salesCenterKey => TRACKED.has(String(salesCenterKey ?? ''));

// Active homes the market robot already has (Sun or Foxfire), by loose key.
export function marketKeys(market) {
  const keys = new Map();
  for (const h of Object.values(market?.homes || {})) {
    if (h && !h.gone && h.address) keys.set(matchKey(h.address), h.source);
  }
  return keys;
}

// From one clean MHVillage read: keep homes not sold by Sun or Foxfire,
// drop any address the market robot already lists, and drop repeats.
export function pickOthers(listings, market) {
  const known = marketKeys(market);
  const kept = new Map();
  const dropped = [];
  for (const l of listings) {
    if (isTracked(l.sellerKey)) continue;
    const k = matchKey(l.address);
    if (!l.address || !/^\d/.test(k)) { dropped.push({ ...l, why: 'no street address' }); continue; }
    if (known.has(k)) { dropped.push({ ...l, why: 'already listed by ' + known.get(k) }); continue; }
    if (kept.has(k)) { dropped.push({ ...l, why: 'same address twice in MHVillage' }); continue; }
    kept.set(k, { ...l, matchKey: k });
  }
  return { homes: [...kept.values()], dropped };
}

// Merge a clean read into history. A home is called gone only after two
// clean reads in a row miss it (same rule as the market robot).
// A failed read never reaches this function.
export function mergeHistory(db, homes, today, { clean = true } = {}) {
  db.homes ||= {};
  const seen = new Set();
  for (const h of homes) {
    seen.add(h.matchKey);
    const old = db.homes[h.matchKey];
    if (!old) {
      db.homes[h.matchKey] = { address: h.address, price: h.price, status: h.pending ? 'pending' : 'active',
        seller: h.seller, sellerType: h.sellerType, url: h.url, firstSeen: today, lastSeen: today,
        prices: [{ date: today, price: h.price }], gone: false, goneDate: null };
      continue;
    }
    const last = old.prices[old.prices.length - 1];
    if (h.price && (!last || last.price !== h.price)) old.prices.push({ date: today, price: h.price });
    Object.assign(old, { address: h.address, price: h.price, status: h.pending ? 'pending' : 'active',
      seller: h.seller, sellerType: h.sellerType, url: h.url, lastSeen: today, gone: false, goneDate: null });
    delete old.firstAbsent;
  }
  if (!clean) return db;                 // partial read: update what was seen, call nothing gone
  for (const [k, h] of Object.entries(db.homes)) {
    if (h.gone || seen.has(k)) continue;
    if (h.firstAbsent) { h.gone = true; h.goneDate = today; h.status = 'gone'; delete h.firstAbsent; }
    else h.firstAbsent = today;
  }
  return db;
}
