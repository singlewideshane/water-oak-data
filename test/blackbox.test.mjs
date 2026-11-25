// Black box: price history rows and the off-list record. Never writes data/market.json.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blackBoxCsv, blackBoxRows, recordSeen, sourceStatus } from '../market.mjs';

const home = (address, source, price) => ({ source, address, price, beds: 2, baths: 2, sqft: 1000,
  year: 1990, parking: 'None', pending: false, url: 'https://example.test/' + address });
const run = (db, today, sun, fox) => { const ok = sourceStatus(db, sun, fox); recordSeen(db, { today, sun, fox, ok }); };

test('row shows first ask, cuts, and full history', () => {
  const [r] = blackBoxRows({ a: { address: '711 E Norman St', source: 'Foxfire', firstSeen: '2026-10-04',
    onAtStart: true, gone: false, prices: [{ date: '2026-10-04', price: 72000 }, { date: '2026-10-22', price: 68500 }] } });
  assert.equal(r.first_ask, 72000); assert.equal(r.current_ask, 68500);
  assert.equal(r.cuts, 1); assert.equal(r.total_cut, 3500);
  assert.equal(r.last_price_change, '2026-10-22'); assert.equal(r.on_at_start, 'yes');
  assert.equal(r.status, 'for sale');
  assert.equal(r.price_history, '2026-10-04 $72,000; 2026-10-22 $68,500');
});

test('a home that leaves and comes back keeps its off-list stretch and first-seen date', () => {
  const db = { version: 3, started: '2026-10-04', updated: null, runs: [{ date: '2026-10-04' }], homes: {} };
  const others = n => Array.from({ length: n }, (_, i) => home(`${100 + i} Oak St`, 'Sun', 90000));
  const fox = [home('1 Fox Ln', 'Foxfire', 60000)];
  run(db, '2026-10-04', [home('5 Birch St', 'Sun', 80000), ...others(6)], fox);
  run(db, '2026-10-08', others(6), fox);       // first miss
  run(db, '2026-10-12', others(6), fox);       // second miss -> gone
  assert.equal(db.homes['5 birch st'].gone, true);
  run(db, '2026-10-15', [home('5 Birch St', 'Sun', 75000), ...others(6)], fox);
  const h = db.homes['5 birch st'];
  assert.equal(h.gone, false);
  assert.equal(h.firstSeen, '2026-10-04');
  assert.deepEqual(h.offList, [{ left: '2026-10-12', back: '2026-10-15' }]);
  const r = blackBoxRows(db.homes).find(x => x.address === '5 Birch St');
  assert.equal(r.times_off_list, 1); assert.equal(r.cuts, 1);
});

test('csv quotes the history column and has one row per home', () => {
  const csv = blackBoxCsv({ a: { address: '1 A St', source: 'Sun', gone: true, goneDate: '2026-11-01',
    prices: [{ date: '2026-10-04', price: 50000 }] } });
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /left the list/);
  assert.match(lines[1], /"2026-10-04 \$50,000"/);
});
