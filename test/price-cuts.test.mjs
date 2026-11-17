// Price-cut list, Friday summary lines, and listing-id backup matching.
// Never writes data/market.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { keyOf, listingIdOf, priceCuts, priceCutSummary, recordSeen, repeatedCuts } from '../market.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketPath = path.join(root, 'data/market.json');

const fox = (address, price, id) => ({
  source: 'Foxfire', address, price, beds: 2, baths: 2, sqft: 1200, year: 1999, parking: 'None', pending: false,
  url: `https://foxfiremanufactured.com/HomedetailCustom.asp?id=${id}`
});
const sun = (address, price, site) => ({ source: 'Sun', address, price, pending: false, site });
const db0 = () => ({ version: 3, started: '2026-10-04', updated: null, runs: [{ date: '2026-10-04' }], homes: {} });
const run = (db, today, s, f) => recordSeen(db, { today, sun: s, fox: f, ok: { Sun: true, Foxfire: true } });

/* ---------- A: price-cut list ---------- */

test('each cut has its date, old and new price, dollars and percent; totals from first ask seen', () => {
  const h = { source: 'Foxfire', address: '711 E Norman St', url: 'x?id=26968', gone: false,
    prices: [{ date: '2026-10-04', price: 72000 }, { date: '2026-10-22', price: 68500 }, { date: '2026-11-05', price: 65000 }] };
  const before = JSON.stringify(h);
  const [r] = priceCuts([h], '2026-11-17');
  assert.equal(JSON.stringify(h), before, 'input not changed');
  assert.equal(r.stableId, '26968');
  assert.equal(r.firstAskSeen, 72000);
  assert.equal(r.currentAsk, 65000);
  assert.equal(r.cutCount, 2);
  assert.equal(r.totalDollars, 7000);
  assert.ok(Math.abs(r.percent - 7000 / 72000) < 1e-12);
  assert.deepEqual(r.cuts.map(c => [c.date, c.from, c.to, c.dollars]),
    [['2026-10-22', 72000, 68500, 3500], ['2026-11-05', 68500, 65000, 3500]]);
});

test('a single cut is listed (repeated_cuts would skip it), no-cut homes are not', () => {
  const one = { source: 'Sun', address: '1 Oak St', site: 'WAT-1', prices: [{ date: '2026-10-01', price: 100000 }, { date: '2026-10-15', price: 95000 }] };
  const none = { source: 'Sun', address: '2 Elm St', site: 'WAT-2', prices: [{ date: '2026-10-01', price: 90000 }] };
  assert.equal(priceCuts([one, none], '2026-11-01').length, 1);
  assert.equal(repeatedCuts([one, none], '2026-11-01').length, 0);
});

test('first-absence and gone status are reported, never turned into sold', () => {
  const p = [{ date: '2026-10-01', price: 100000 }, { date: '2026-10-15', price: 95000 }];
  const rows = priceCuts([
    { source: 'Sun', address: '1 Oak St', prices: p, firstAbsent: '2026-11-01' },
    { source: 'Sun', address: '2 Oak St', prices: p, gone: true }
  ], '2026-11-02');
  assert.deepEqual(rows.map(r => r.status), ['firstAbsent', 'gone']);
});

test('the stored history produces a cut list and is not written', () => {
  const bytes = fs.readFileSync(marketPath);
  const db = JSON.parse(bytes.toString('utf8'));
  const rows = priceCuts(db.homes, db.updated);
  assert.ok(rows.length > 0);
  for (const r of rows) for (const c of r.cuts) assert.ok(c.to < c.from && c.dollars > 0);
  assert.ok(fs.readFileSync(marketPath).equals(bytes), 'data/market.json was not written');
});

/* ---------- B: Friday summary ---------- */

test('summary counts cuts in the last 7 and 30 days and homes cut twice', () => {
  const homes = [
    { address: 'A', prices: [{ date: '2026-11-01', price: 100000 }, { date: '2026-11-15', price: 90000 }] },        // 10% this week
    { address: 'B', prices: [{ date: '2026-10-01', price: 100000 }, { date: '2026-10-25', price: 95000 }] },        // 30-day only
    { address: 'C', prices: [{ date: '2026-09-01', price: 100000 }, { date: '2026-09-02', price: 99000 }] }         // too old
  ];
  assert.deepEqual(priceCutSummary(homes, '2026-11-20'), [
    'Price cuts, last 7 days: 1 home, average 10.0% off',
    'Homes with a cut, last 30 days: 2',
    'Cut twice within 60 days: 0'
  ]);
  assert.equal(priceCutSummary([], '2026-11-20')[0], 'Price cuts, last 7 days: 0 homes');
});

test('morning report: unchanged on other days, three extra lines on Friday', () => {
  const runReport = env => execFileSync('node', ['website/morning-report.mjs'], { cwd: root, env: { ...process.env, ...env } }).toString();
  const tue = runReport({ REPORT_WEEKDAY: 'Tue', REPORT_DATE: '2026-11-17' });
  const fri = runReport({ REPORT_WEEKDAY: 'Fri', REPORT_DATE: '2026-11-17' });
  assert.doesNotMatch(tue, /Price cuts/);
  assert.ok(fri.startsWith(tue.trimEnd().split('\n\nHeads up')[0]));
  assert.match(fri, /Price cuts, last 7 days: /);
  assert.match(fri, /Homes with a cut, last 30 days: \d+/);
  assert.match(fri, /Cut twice within 60 days: \d+/);
});

/* ---------- C: listing-id backup matching ---------- */

test('listing ids: Foxfire from the URL, Sun from the site number, nothing else', () => {
  assert.equal(listingIdOf(fox('1 A St', 1, 27243)), '27243');
  assert.equal(listingIdOf(sun('1 A St', 1, 'wat-2014')), 'WAT-2014');
  assert.equal(listingIdOf({ source: 'Sun', address: '1 A St' }), null);
  assert.equal(listingIdOf({ source: 'MHVillage', url: 'x?id=5' }), null);
});

test('a re-spelled address with the same listing id keeps its history and is not a miss', () => {
  const db = db0();
  run(db, '2026-11-02', [sun('427 Bemen Dr', 189900, 'WAT-2014')], [fox('611 Nicklaus Ct', 164900, 27001)]);
  run(db, '2026-11-05', [sun('427 Bemen Drive Lot 12', 185000, 'WAT-2014')], [fox('611 Nicklaus Court', 164900, 27001)]);
  run(db, '2026-11-09', [sun('427 Bemen Rd', 185000, 'WAT-2014')], [fox('611 Nicklaus Crt', 159900, 27001)]);
  assert.equal(Object.keys(db.homes).length, 2, 'no duplicate homes');
  const s = db.homes[keyOf('427 Bemen Dr')];
  assert.deepEqual(s.prices.map(p => p.price), [189900, 185000]);
  assert.equal(s.firstSeen, '2026-11-02');
  assert.ok(!s.gone && !s.firstAbsent);
  const f = db.homes[keyOf('611 Nicklaus Ct')];
  assert.deepEqual(f.prices.map(p => p.price), [164900, 159900]);
  assert.ok(!f.gone && !f.firstAbsent);
});

test('a different listing id at a new address is a new home; the old one starts its two-miss clock', () => {
  const db = db0();
  run(db, '2026-11-02', [], [fox('1 Oak St', 100000, 1), fox('2 Elm St', 90000, 2)]);
  run(db, '2026-11-05', [], [fox('1 Oak St', 100000, 1), fox('3 Pine St', 80000, 3)]);
  assert.equal(Object.keys(db.homes).length, 3);
  assert.equal(db.homes[keyOf('2 Elm St')].firstAbsent, '2026-11-05');
  assert.ok(!db.homes[keyOf('2 Elm St')].gone);
});

test('an address match always wins, and an id shared by two saved homes is not guessed', () => {
  const db = db0();
  db.homes['5 a st'] = { ...fox('5 A St', 1, 9), firstSeen: '2026-10-04', lastSeen: '2026-10-04', prices: [{ date: '2026-10-04', price: 1 }], gone: false };
  db.homes['6 b st'] = { ...fox('6 B St', 1, 9), firstSeen: '2026-10-04', lastSeen: '2026-10-04', prices: [{ date: '2026-10-04', price: 1 }], gone: false };
  run(db, '2026-11-02', [], [fox('7 C St', 2, 9)]);
  assert.ok(db.homes['7 c st'], 'ambiguous id: treated as a new home, not merged');
  run(db, '2026-11-05', [], [fox('5 A St', 3, 9), fox('6 B St', 3, 9), fox('7 C St', 3, 9)]);
  assert.deepEqual(db.homes['5 a st'].prices.at(-1).price, 3);
});

test('the scan writes price_cuts.json and the workflow commits it', () => {
  const scrape = fs.readFileSync(path.join(root, 'scrape.mjs'), 'utf8');
  const yml = fs.readFileSync(path.join(root, '.github/workflows/market.yml'), 'utf8');
  assert.match(scrape, /priceCuts\(db\.homes, today\)/);
  assert.match(scrape, /data\/price_cuts\.json/);
  assert.match(yml, /git add data\/market\.json list-to-sold\/to_check\.csv data\/repeated_cuts\.json data\/price_cuts\.json/);
});
