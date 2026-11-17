// Gone-clock for the market robot. Pure: no network, no files.
// scrape.mjs calls sourceStatus() and then, for a run that has at least one
// clean source, recordSeen(). A source is clean only when the existing
// completeness check passes (non-empty, and not a drop of half or more once
// that source already has 6 active homes).
//
// Each clean pull replaces that source's saved set with the homes actually
// seen. The next clean pull compares against that set:
//   seen again            -> clear any pending first absence
//   in the saved set, now missing -> first absence (firstAbsent = this date)
//   already missing from the saved set -> gone, goneDate = this date
// A pull that is missing or fails the check does not touch that source, so a
// first absence already recorded stays put and is not counted twice.

// "Lot 2504" and "Site #WAT-2007" are not part of the street, so two sources
// still name the same home.
export function stripLotSite(a) {
  return String(a ?? '').replace(/\b(?:lot|site)\b\s*:?\s*(?:no\.?\s*)?#?\s*(?:[a-z]{0,8}-)?\d+\b/gi, ' ');
}

export const keyOf = a => stripLotSite(a).toLowerCase().replace(/[.,#]/g, ' ')
  .replace(/\b(drive)\b/g, 'dr').replace(/\b(street)\b/g, 'st').replace(/\b(lane|la)\b/g, 'ln')
  .replace(/\b(circle)\b/g, 'cir').replace(/\b(square)\b/g, 'sq').replace(/\b(court)\b/g, 'ct')
  .replace(/\b(avenue)\b/g, 'ave').replace(/\b(east)\b/g, 'e').replace(/\b(west)\b/g, 'w')
  .replace(/\s+/g, ' ').trim();

const SOURCES = ['Sun', 'Foxfire'];

// Same rule the robot used when one miss was enough: empty/failed scans and
// big drops are not a basis for calling a home gone.
export function scanIsComplete(prevActive, list) {
  return !!list && list.length > 0 && !(prevActive >= 6 && list.length < prevActive * 0.5);
}

export function sourceStatus(db, sun, fox) {
  const ok = {};
  for (const [src, list] of [['Sun', sun], ['Foxfire', fox]]) {
    const prev = Object.values(db.homes).filter(h => h.source === src && !h.gone).length;
    ok[src] = scanIsComplete(prev, list);
  }
  return ok;
}

// The listing's own id on its source site: Foxfire's id in the listing URL,
// Sun's site number (WAT-1234). Used only as a backup when the address key
// misses, so a re-spelled address is the same home, not a new one.
export function listingIdOf(h) {
  if (!h) return null;
  if (h.source === 'Foxfire') {
    const m = String(h.url || '').match(/[?&]id=(\d+)/i);
    return m ? m[1] : null;
  }
  if (h.source === 'Sun' && h.site) return String(h.site).toUpperCase();
  return null;
}

// Saved record for this listing id, or null. Ambiguous (two records with the
// same id and source) is treated as no match: never guess.
function findByListingId(db, h, claimed) {
  const lid = listingIdOf(h);
  if (!lid) return null;
  const hits = Object.keys(db.homes).filter(k =>
    !claimed.has(k) && db.homes[k].source === h.source && listingIdOf(db.homes[k]) === lid);
  if (hits.length === 1) return hits[0];
  const live = hits.filter(k => !db.homes[k].gone);
  return live.length === 1 ? live[0] : null;
}

// Merge this pull's clean listings into db.homes (prices, lastSeen, reappearance),
// then advance the gone-clock. Incomplete sources are omitted by the caller via `ok`.
// Match order: address key first (unchanged), then the listing id.
export function recordSeen(db, { today, sun, fox, ok }) {
  const first = !db.runs.length || db.started === today;
  const seenBySource = { Sun: [], Foxfire: [] };
  const pull = [...(ok.Sun ? sun : []), ...(ok.Foxfire ? fox : [])];
  const claimed = new Set(pull.map(h => keyOf(h.address)).filter(k => db.homes[k]));
  for (const h of pull) {
    let id = keyOf(h.address);
    if (!db.homes[id]) {
      const byListing = findByListingId(db, h, claimed);
      if (byListing) { id = byListing; claimed.add(id); }
    }
    if (seenBySource[h.source]) seenBySource[h.source].push(id);
    const old = db.homes[id];
    if (!old) db.homes[id] = { ...h, firstSeen: today, lastSeen: today, onAtStart: first, prices: [{ date: today, price: h.price }], gone: false, goneDate: null };
    else {
      const lastP = old.prices[old.prices.length - 1];
      if (!lastP || lastP.price !== h.price) old.prices.push({ date: today, price: h.price });
      Object.assign(old, h, { lastSeen: today, gone: false, goneDate: null });
      delete old.firstAbsent;
    }
  }
  applyGoneGuard(db, { today, seenBySource, ok });
}

export function applyGoneGuard(db, { today, seenBySource, ok }) {
  for (const src of SOURCES) {
    if (!ok?.[src]) continue;
    if (!db.seen || typeof db.seen !== 'object' || Array.isArray(db.seen)) db.seen = {};
    const now = new Set(seenBySource?.[src] || []);
    const prior = db.seen[src];
    const hadSnapshot = !!(prior && Array.isArray(prior.ids));
    const prevIds = hadSnapshot ? new Set(prior.ids) : null;
    let pending = 0, marked = 0;
    for (const [id, h] of Object.entries(db.homes)) {
      if (h.source !== src || h.gone) continue;
      if (now.has(id)) {
        delete h.firstAbsent;
        continue;
      }
      if (hadSnapshot && !prevIds.has(id)) {
        h.gone = true;
        h.goneDate = today;
        delete h.firstAbsent;
        marked++;
      } else if (hadSnapshot && prevIds.has(id)) {
        h.firstAbsent = today;
        pending++;
      } else {
        // No saved set yet (first run of this guard, or this source has never
        // had a clean pull under it). A miss here starts the clock. It cannot
        // confirm a previous clean miss, and it must not move a firstAbsent
        // date that was already stored.
        if (!h.firstAbsent) h.firstAbsent = today;
        pending++;
      }
    }
    db.seen[src] = { date: today, ids: [...now].sort() };
    console.log(`${src}: ${pending} waiting on a second clean miss, ${marked} marked gone`);
  }
}

const DAY_MS = 86400000;

// Sun keeps its MHVillage key when it has one. Foxfire's id lives in the
// listing URL. A Sun site number is used only when nothing else identifies
// the home, so a new page url does not replace a key already saved.
function stableIdOf(h) {
  if (h.key != null && h.key !== '') return String(h.key);
  const url = String(h.url || '');
  const fox = url.match(/[?&]id=(\d+)/i);
  if (fox) return fox[1];
  const sun = url.match(/\/homes\/(\d+)/);
  if (sun) return sun[1];
  if (h.site) return String(h.site);
  return null;
}

function daysApart(a, b) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
}

// Step-down dates that have another step-down within 60 days.
function cutsWithin60(prices) {
  const dates = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i].price < prices[i - 1].price) dates.push(prices[i].date);
  }
  return dates.filter((d, i) => dates.some((other, j) => i !== j && daysApart(d, other) <= 60));
}

function cutStatus(h) {
  if (h.gone) return 'gone';
  if (h.firstAbsent) return 'firstAbsent';
  return 'active';
}

// Homes whose stored asking prices step down twice inside 60 days.
// Uses the series recordSeen already merged. A single miss (firstAbsent) stays
// in the list and is not called gone. dom is empty: firstSeen is not a list date.
export function repeatedCuts(homes, asOf) {
  const list = Array.isArray(homes) ? homes : Object.values(homes || {});
  const rows = [];
  for (const h of list) {
    if (!h) continue;
    const prices = (h.prices || []).filter(p => p && p.date <= asOf);
    const cuts = cutsWithin60(prices);
    if (cuts.length < 2) continue;
    const first = prices[0].price;
    const current = prices[prices.length - 1].price;
    rows.push({
      address: h.address,
      source: h.source,
      stableId: stableIdOf(h),
      originalAsk: first,
      currentAsk: current,
      reductionCount: cuts.length,
      totalDollars: first - current,
      percent: first ? (first - current) / first : null,
      status: cutStatus(h),
      dom: null
    });
  }
  rows.sort((a, b) => String(a.address).localeCompare(String(b.address))
    || String(a.stableId).localeCompare(String(b.stableId)));
  return rows;
}

// Every home with at least one asking-price cut in its stored history, up to asOf.
// Each cut: the run date it was first seen, old and new price, dollars and percent.
// Totals run from the first price the robot saw to the current one.
// Read-only: works from the prices list recordSeen already keeps.
export function priceCuts(homes, asOf) {
  const list = Array.isArray(homes) ? homes : Object.values(homes || {});
  const rows = [];
  for (const h of list) {
    if (!h) continue;
    const prices = (h.prices || []).filter(p => p && p.date <= asOf);
    const cuts = [];
    for (let i = 1; i < prices.length; i++) {
      const from = prices[i - 1].price, to = prices[i].price;
      if (to < from) cuts.push({ date: prices[i].date, from, to, dollars: from - to, percent: from ? (from - to) / from : null });
    }
    if (!cuts.length) continue;
    const first = prices[0].price, current = prices[prices.length - 1].price;
    rows.push({
      address: h.address,
      source: h.source,
      stableId: stableIdOf(h),
      status: cutStatus(h),
      firstAskSeen: first,
      currentAsk: current,
      cutCount: cuts.length,
      totalDollars: first - current,
      percent: first ? (first - current) / first : null,
      cuts
    });
  }
  rows.sort((a, b) => String(a.address).localeCompare(String(b.address))
    || String(a.stableId).localeCompare(String(b.stableId)));
  return rows;
}

// Three plain lines for the weekly (Friday) morning email. Counts only.
export function priceCutSummary(homes, asOf) {
  const day = d => Date.parse(asOf) - Date.parse(d);
  const rows = priceCuts(homes, asOf);
  const week = rows.map(r => r.cuts.filter(c => day(c.date) >= 0 && day(c.date) < 7 * DAY_MS)).filter(c => c.length);
  const weekCuts = week.flat();
  const avg = weekCuts.length ? weekCuts.reduce((s, c) => s + c.percent, 0) / weekCuts.length : 0;
  const month = rows.filter(r => r.cuts.some(c => day(c.date) >= 0 && day(c.date) < 30 * DAY_MS)).length;
  const twice = repeatedCuts(homes, asOf).length;
  return [
    `Price cuts, last 7 days: ${week.length} home${week.length === 1 ? '' : 's'}` + (week.length ? `, average ${(avg * 100).toFixed(1)}% off` : ''),
    `Homes with a cut, last 30 days: ${month}`,
    `Cut twice within 60 days: ${twice}`
  ];
}
