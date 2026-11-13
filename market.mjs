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

export const keyOf = a => a.toLowerCase().replace(/[.,#]/g, ' ')
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

// Merge this pull's clean listings into db.homes (prices, lastSeen, reappearance),
// then advance the gone-clock. Incomplete sources are omitted by the caller via `ok`.
export function recordSeen(db, { today, sun, fox, ok }) {
  const first = !db.runs.length || db.started === today;
  const seenBySource = { Sun: [], Foxfire: [] };
  for (const h of [...(ok.Sun ? sun : []), ...(ok.Foxfire ? fox : [])]) {
    const id = keyOf(h.address);
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

// Sun keeps its MHVillage key. Foxfire's id lives only in the listing URL.
function stableIdOf(h) {
  if (h.key != null && h.key !== '') return String(h.key);
  const url = String(h.url || '');
  const fox = url.match(/[?&]id=(\d+)/i);
  if (fox) return fox[1];
  const sun = url.match(/\/homes\/(\d+)/);
  return sun ? sun[1] : null;
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
