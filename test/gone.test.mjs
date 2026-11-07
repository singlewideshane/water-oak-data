// Local sequences for the two-pull gone-clock. Never writes data/market.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyGoneGuard, keyOf, recordSeen, scanIsComplete, sourceStatus } from '../market.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketPath = path.join(root, 'data/market.json');

function fresh() {
  return { version: 3, started: '2026-10-04', updated: null, runs: [{ date: '2026-10-04' }], homes: {} };
}
function home(address, source, price = 100000) {
  return {
    source, address, price, beds: 2, baths: 2, sqft: 1200, year: 1999,
    parking: 'None', pending: false, url: 'https://example.test/' + address
  };
}
function apply(db, today, sun, fox) {
  const ok = sourceStatus(db, sun, fox);
  if (!ok.Sun && !ok.Foxfire) return { ok, aborted: true };
  const runs = JSON.stringify(db.runs);
  const updated = db.updated;
  recordSeen(db, { today, sun, fox, ok });
  assert.equal(JSON.stringify(db.runs), runs, 'run log stays owned by scrape.mjs');
  assert.equal(db.updated, updated, 'recordSeen does not stamp updated');
  assert.equal(db.version, 3);
  return { ok, aborted: false };
}
function world() {
  const db = fresh();
  const sun = [home('1 Oak St', 'Sun', 100000), home('2 Elm St', 'Sun', 110000)];
  const fox = [home('3 Pine Dr', 'Foxfire', 90000), home('4 Cedar Dr', 'Foxfire', 95000)];
  const res = apply(db, '2026-11-09', sun, fox);
  assert.equal(res.aborted, false);
  return { db, sun, fox };
}
const id = keyOf;
function row(db, address) { return db.homes[id(address)]; }

test('scan completeness is the existing empty-scan and big-drop rule', () => {
  assert.equal(scanIsComplete(0, null), false);
  assert.equal(scanIsComplete(10, null), false);
  assert.equal(scanIsComplete(10, []), false);
  assert.equal(scanIsComplete(0, [1]), true);
  assert.equal(scanIsComplete(5, [1]), true);       // drop guard starts at 6 active homes
  assert.equal(scanIsComplete(6, Array(3).fill(1)), true);  // exactly half is still kept
  assert.equal(scanIsComplete(6, Array(2).fill(1)), false); // below half is rejected
  assert.equal(scanIsComplete(28, Array(14).fill(1)), true);
  assert.equal(scanIsComplete(28, Array(13).fill(1)), false);
});

test('first clean pull saves each source\'s full set and does not mark those homes gone', () => {
  const { db } = world();
  assert.equal(row(db, '1 Oak St').gone, false);
  assert.equal(row(db, '1 Oak St').firstAbsent, undefined);
  assert.equal(row(db, '1 Oak St').firstSeen, '2026-11-09');
  assert.equal(row(db, '1 Oak St').lastSeen, '2026-11-09');
  assert.equal(row(db, '1 Oak St').onAtStart, false);
  assert.deepEqual(db.seen.Sun, { date: '2026-11-09', ids: ['1 oak st', '2 elm st'] });
  assert.deepEqual(db.seen.Foxfire, { date: '2026-11-09', ids: ['3 pine dr', '4 cedar dr'] });
});

test('absent once then present: not gone, and the pending miss is cleared', () => {
  const { db, sun, fox } = world();
  const kept = [sun[0]];
  apply(db, '2026-11-12', kept, fox);
  const elm = row(db, '2 Elm St');
  assert.equal(elm.gone, false);
  assert.equal(elm.goneDate, null);
  assert.equal(elm.firstAbsent, '2026-11-12');
  assert.equal(elm.lastSeen, '2026-11-09');
  assert.equal(elm.firstSeen, '2026-11-09');
  assert.deepEqual(elm.prices, [{ date: '2026-11-09', price: 110000 }]);
  assert.deepEqual(db.seen.Sun.ids, ['1 oak st']);

  apply(db, '2026-11-16', sun, fox);
  assert.equal(elm.gone, false);
  assert.equal(elm.goneDate, null);
  assert.equal(elm.firstAbsent, undefined);
  assert.equal(elm.lastSeen, '2026-11-16');
  assert.equal(elm.firstSeen, '2026-11-09');
  assert.deepEqual(db.seen.Sun.ids, ['1 oak st', '2 elm st']);
  assert.equal(row(db, '1 Oak St').gone, false);
});

test('absent twice on clean pulls: gone on the second date, and a later miss does not move it', () => {
  const { db, sun, fox } = world();
  const kept = [sun[0]];
  apply(db, '2026-11-12', kept, fox);
  apply(db, '2026-11-16', kept, fox);
  const elm = row(db, '2 Elm St');
  assert.equal(elm.gone, true);
  assert.equal(elm.goneDate, '2026-11-16');
  assert.equal(elm.firstAbsent, undefined);
  assert.equal(elm.lastSeen, '2026-11-09');
  assert.equal(elm.firstSeen, '2026-11-09');
  assert.deepEqual(db.seen.Sun.ids, ['1 oak st']);
  // to_check.csv is rebuilt from gone homes; one miss must not queue it, the second does.
  const queued = () => Object.values(db.homes).filter(h => h.gone).map(h => h.address);
  assert.deepEqual(queued(), ['2 Elm St']);

  apply(db, '2026-11-19', kept, fox);
  assert.equal(elm.gone, true);
  assert.equal(elm.goneDate, '2026-11-16');
});

test('absent, failed pull, absent: the failed pull pauses the clock and the next clean miss finishes it', () => {
  const { db, sun, fox } = world();
  const kept = [sun[0]];
  apply(db, '2026-11-12', kept, fox);
  const snap = JSON.parse(JSON.stringify(db.seen.Sun));
  const paused = apply(db, '2026-11-13', null, fox);
  assert.equal(paused.aborted, false);
  assert.equal(paused.ok.Sun, false);
  assert.equal(paused.ok.Foxfire, true);
  const elm = row(db, '2 Elm St');
  assert.equal(elm.gone, false);
  assert.equal(elm.firstAbsent, '2026-11-12');
  assert.equal(elm.lastSeen, '2026-11-09');
  assert.deepEqual(db.seen.Sun, snap);
  assert.equal(row(db, '1 Oak St').lastSeen, '2026-11-12');
  assert.equal(row(db, '3 Pine Dr').lastSeen, '2026-11-13');

  apply(db, '2026-11-16', kept, fox);
  assert.equal(elm.gone, true);
  assert.equal(elm.goneDate, '2026-11-16');
  assert.equal(elm.firstAbsent, undefined);
});

test('a rejected partial list does not clear a first absence or replace the saved set', () => {
  const db = fresh();
  const sun = [1, 2, 3, 4, 5, 6].map(n => home(`${n} Oak St`, 'Sun', 100000 + n));
  const fox = [home('9 Fox Ln', 'Foxfire', 80000)];
  apply(db, '2026-11-09', sun, fox);
  apply(db, '2026-11-12', sun.slice(0, 3), fox);
  for (const n of [4, 5, 6]) {
    assert.equal(row(db, `${n} Oak St`).firstAbsent, '2026-11-12');
    assert.equal(row(db, `${n} Oak St`).gone, false);
  }
  const sunSnap = JSON.parse(JSON.stringify(db.seen.Sun));
  const before = JSON.parse(JSON.stringify(db.homes));
  // 2 of 6 active Sun homes: below half, so the whole Sun pull is rejected
  // even though it "sees" a home that already has a first absence.
  // Foxfire is a full clean pull, so its own snapshot date may move.
  const res = apply(db, '2026-11-13', [sun[0], sun[3]], fox);
  assert.equal(res.ok.Sun, false);
  assert.equal(res.ok.Foxfire, true);
  assert.deepEqual(db.seen.Sun, sunSnap);
  assert.equal(row(db, '4 Oak St').firstAbsent, '2026-11-12');
  assert.equal(row(db, '4 Oak St').gone, false);
  assert.equal(row(db, '1 Oak St').lastSeen, '2026-11-12');
  assert.deepEqual(row(db, '1 Oak St').prices, before['1 oak st'].prices);

  apply(db, '2026-11-16', sun.slice(0, 3), fox);
  for (const n of [4, 5, 6]) {
    assert.equal(row(db, `${n} Oak St`).gone, true);
    assert.equal(row(db, `${n} Oak St`).goneDate, '2026-11-16');
    assert.equal(row(db, `${n} Oak St`).firstAbsent, undefined);
  }
  assert.equal(row(db, '1 Oak St').gone, false);
});

test('failed pulls only: nothing is marked gone and no first absence is started', () => {
  const { db } = world();
  const before = JSON.stringify(db);
  assert.equal(apply(db, '2026-11-12', null, null).aborted, true);
  assert.equal(apply(db, '2026-11-13', [], []).aborted, true);
  assert.equal(JSON.stringify(db), before);

  const migrated = fresh();
  migrated.homes['1 oak st'] = {
    source: 'Sun', address: '1 Oak St', price: 100000, beds: 2, baths: 2, sqft: 1, year: 2000,
    parking: 'None', pending: false, url: 'u', firstSeen: '2026-11-05', lastSeen: '2026-11-05',
    onAtStart: false, prices: [{ date: '2026-11-05', price: 100000 }], gone: false, goneDate: null
  };
  const prior = JSON.stringify(migrated);
  assert.equal(apply(migrated, '2026-11-12', null, null).aborted, true);
  assert.equal(apply(migrated, '2026-11-13', [], []).aborted, true);
  assert.equal(JSON.stringify(migrated), prior);
});

test('an incomplete source does not pause the other source', () => {
  const { db, sun, fox } = world();
  apply(db, '2026-11-12', [sun[0]], [fox[0]]);
  assert.equal(row(db, '2 Elm St').firstAbsent, '2026-11-12');
  assert.equal(row(db, '4 Cedar Dr').firstAbsent, '2026-11-12');
  apply(db, '2026-11-13', null, [fox[0]]);
  assert.equal(row(db, '2 Elm St').gone, false);
  assert.equal(row(db, '2 Elm St').firstAbsent, '2026-11-12');
  assert.equal(row(db, '4 Cedar Dr').gone, true);
  assert.equal(row(db, '4 Cedar Dr').goneDate, '2026-11-13');
  assert.equal(row(db, '3 Pine Dr').gone, false);
  apply(db, '2026-11-16', [sun[0]], [fox[0]]);
  assert.equal(row(db, '2 Elm St').gone, true);
  assert.equal(row(db, '2 Elm St').goneDate, '2026-11-16');
  assert.equal(row(db, '4 Cedar Dr').goneDate, '2026-11-13');
});

test('a sighting restarts the clock, including when a gone home comes back', () => {
  const { db, sun, fox } = world();
  const kept = [sun[0]];
  apply(db, '2026-11-12', kept, fox);
  apply(db, '2026-11-16', sun, fox);
  apply(db, '2026-11-19', kept, fox);
  assert.equal(row(db, '2 Elm St').gone, false);
  assert.equal(row(db, '2 Elm St').firstAbsent, '2026-11-19');
  apply(db, '2026-11-23', kept, fox);
  assert.equal(row(db, '2 Elm St').gone, true);
  assert.equal(row(db, '2 Elm St').goneDate, '2026-11-23');

  const back = home('2 Elm St', 'Sun', 105000);
  apply(db, '2026-11-26', [sun[0], back], fox);
  const elm = row(db, '2 Elm St');
  assert.equal(elm.gone, false);
  assert.equal(elm.goneDate, null);
  assert.equal(elm.firstAbsent, undefined);
  assert.equal(elm.firstSeen, '2026-11-09');
  assert.equal(elm.lastSeen, '2026-11-26');
  assert.deepEqual(elm.prices.map(p => p.price), [110000, 105000]);
  apply(db, '2026-11-30', kept, fox);
  assert.equal(elm.gone, false);
  assert.equal(elm.firstAbsent, '2026-11-30');
});

test('price history and lastSeen still update only for homes in a clean pull', () => {
  const { db, sun, fox } = world();
  const cheaper = home('1 Oak St', 'Sun', 90000);
  apply(db, '2026-11-12', [cheaper], fox);
  const oak = row(db, '1 Oak St');
  assert.deepEqual(oak.prices, [
    { date: '2026-11-09', price: 100000 },
    { date: '2026-11-12', price: 90000 }
  ]);
  assert.equal(oak.lastSeen, '2026-11-12');
  assert.equal(row(db, '2 Elm St').lastSeen, '2026-11-09');
  assert.deepEqual(row(db, '2 Elm St').prices, [{ date: '2026-11-09', price: 110000 }]);
});

test('the saved set is what the next pull compares against', () => {
  const db = fresh();
  db.homes['2 elm st'] = {
    source: 'Sun', address: '2 Elm St', price: 110000, prices: [{ date: '2026-11-09', price: 110000 }],
    firstSeen: '2026-11-09', lastSeen: '2026-11-09', gone: false, goneDate: null, firstAbsent: '2026-11-01'
  };
  db.homes['1 oak st'] = {
    source: 'Sun', address: '1 Oak St', price: 100000, prices: [{ date: '2026-11-09', price: 100000 }],
    firstSeen: '2026-11-09', lastSeen: '2026-11-09', gone: false, goneDate: null
  };
  db.seen = { Sun: { date: '2026-11-09', ids: ['1 oak st', '2 elm st'] } };
  apply(db, '2026-11-12', [home('1 Oak St', 'Sun', 100000)], [home('3 Pine Dr', 'Foxfire', 1)]);
  assert.equal(row(db, '2 Elm St').gone, false);
  assert.equal(row(db, '2 Elm St').firstAbsent, '2026-11-12');

  const trusted = fresh();
  trusted.homes['2 elm st'] = {
    source: 'Sun', address: '2 Elm St', price: 110000, prices: [{ date: '2026-11-09', price: 110000 }],
    firstSeen: '2026-11-09', lastSeen: '2026-11-09', gone: false, goneDate: null
  };
  trusted.seen = { Sun: { date: '2026-11-09', ids: ['1 oak st'] } };
  apply(trusted, '2026-11-12', [home('1 Oak St', 'Sun', 100000)], [home('3 Pine Dr', 'Foxfire', 1)]);
  assert.equal(trusted.homes['2 elm st'].gone, true);
  assert.equal(trusted.homes['2 elm st'].goneDate, '2026-11-12');
});

test('a failed pull cannot clear a first absence even if its raw ids include the home', () => {
  const db = fresh();
  db.homes['2 elm st'] = {
    source: 'Sun', address: '2 Elm St', price: 1, prices: [{ date: '2026-11-09', price: 1 }],
    firstSeen: '2026-11-09', lastSeen: '2026-11-09', gone: false, goneDate: null, firstAbsent: '2026-11-12'
  };
  db.seen = { Sun: { date: '2026-11-09', ids: ['1 oak st'] }, Foxfire: { date: '2026-11-09', ids: ['3 pine dr'] } };
  const before = JSON.stringify(db);
  applyGoneGuard(db, {
    today: '2026-11-13',
    ok: { Sun: false, Foxfire: false },
    seenBySource: { Sun: ['2 elm st'], Foxfire: ['3 pine dr'] }
  });
  assert.equal(JSON.stringify(db), before);
});

test('Drive and Dr are the same home, so a spelling change is not an absence', () => {
  const db = fresh();
  const fox = [home('3 Pine Dr', 'Foxfire', 1)];
  apply(db, '2026-11-09', [home('2 Elm Drive', 'Sun', 110000)], fox);
  apply(db, '2026-11-12', [], fox);
  assert.equal(db.homes['2 elm dr'].firstAbsent, undefined);
  assert.equal(sourceStatus(db, [], fox).Sun, false);
  apply(db, '2026-11-12', [home('9 Other St', 'Sun', 1)], fox);
  assert.equal(db.homes['2 elm dr'].firstAbsent, '2026-11-12');
  apply(db, '2026-11-16', [home('2 Elm Dr', 'Sun', 110000)], fox);
  assert.equal(db.homes['2 elm dr'].gone, false);
  assert.equal(db.homes['2 elm dr'].firstAbsent, undefined);
  assert.equal(db.homes['2 elm dr'].lastSeen, '2026-11-16');
  assert.equal(Object.keys(db.homes).filter(k => k.includes('elm')).length, 1);
});

test('existing history: already-gone homes stay gone, and the first miss under this guard is not enough', () => {
  const bytes = fs.readFileSync(marketPath);
  const db = JSON.parse(bytes.toString('utf8'));
  assert.equal(db.version, 3);
  assert.equal(db.seen, undefined);
  const goneBefore = {};
  for (const [id, h] of Object.entries(db.homes)) {
    if (!h.gone) continue;
    goneBefore[id] = { gone: h.gone, goneDate: h.goneDate, firstSeen: h.firstSeen, lastSeen: h.lastSeen, price: h.price, prices: JSON.stringify(h.prices) };
  }
  assert.equal(Object.keys(goneBefore).length, 11);

  const active = Object.values(db.homes).filter(h => !h.gone).map(h => ({
    source: h.source, address: h.address, price: h.price, beds: h.beds, baths: h.baths,
    sqft: h.sqft, year: h.year, parking: h.parking, pending: h.pending, url: h.url,
    ...(h.key ? { key: h.key } : {}),
    ...('lotRent' in h ? { lotRent: h.lotRent } : {})
  }));
  const sun = active.filter(h => h.source === 'Sun').sort((a, b) => keyOf(a.address).localeCompare(keyOf(b.address)));
  const fox = active.filter(h => h.source === 'Foxfire');
  const dropped = sun[0];
  const droppedId = keyOf(dropped.address);
  const droppedBefore = JSON.parse(JSON.stringify(db.homes[droppedId]));

  apply(db, '2026-11-09', sun.slice(1), fox);
  assert.equal(db.homes[droppedId].gone, false);
  assert.equal(db.homes[droppedId].goneDate, null);
  assert.equal(db.homes[droppedId].firstAbsent, '2026-11-09');
  assert.equal(db.homes[droppedId].lastSeen, droppedBefore.lastSeen);
  assert.equal(db.homes[droppedId].firstSeen, droppedBefore.firstSeen);
  assert.deepEqual(db.homes[droppedId].prices, droppedBefore.prices);
  assert.ok(!db.seen.Sun.ids.includes(droppedId));
  assert.equal(db.seen.Sun.ids.length, sun.length - 1);
  assert.equal(db.seen.Foxfire.ids.length, fox.length);
  for (const [id, prev] of Object.entries(goneBefore)) {
    const h = db.homes[id];
    assert.equal(h.gone, true, id);
    assert.equal(h.goneDate, prev.goneDate, id);
    assert.equal(h.firstSeen, prev.firstSeen, id);
    assert.equal(h.lastSeen, prev.lastSeen, id);
    assert.equal(h.price, prev.price, id);
    assert.equal(JSON.stringify(h.prices), prev.prices, id);
    assert.equal(h.firstAbsent, undefined, id);
  }
  const newlyGone = Object.entries(db.homes).filter(([hid, h]) => h.gone && !goneBefore[hid]);
  assert.deepEqual(newlyGone, []);

  apply(db, '2026-11-12', sun.slice(1), fox);
  assert.equal(db.homes[droppedId].gone, true);
  assert.equal(db.homes[droppedId].goneDate, '2026-11-12');
  assert.equal(db.homes[droppedId].firstAbsent, undefined);
  assert.equal(db.homes[droppedId].lastSeen, droppedBefore.lastSeen);
  for (const [id, prev] of Object.entries(goneBefore)) {
    assert.equal(db.homes[id].gone, true, id);
    assert.equal(db.homes[id].goneDate, prev.goneDate, id);
  }
  const goneIds = Object.entries(db.homes).filter(([, h]) => h.gone).map(([hid]) => hid).sort();
  assert.deepEqual(goneIds, [...Object.keys(goneBefore), droppedId].sort());

  assert.ok(fs.readFileSync(marketPath).equals(bytes), 'data/market.json was not written');
});

test('schedule, to_check rule, and version gate are unchanged', () => {
  const scrape = fs.readFileSync(path.join(root, 'scrape.mjs'), 'utf8');
  const yml = fs.readFileSync(path.join(root, '.github/workflows/market.yml'), 'utf8');
  assert.match(yml, /cron:\s*'0 23 \* \* 1,4'/);
  assert.match(yml, /node scrape\.mjs/);
  assert.match(yml, /git add data\/market\.json list-to-sold\/to_check\.csv/);
  assert.match(scrape, /filter\(h => h\.gone && !covered\.has\(keyOf\(h\.address \|\| ''\)\)\)/);
  assert.match(scrape, /if \(!db \|\| db\.version !== 3\)/);
  assert.match(scrape, /Both scans failed\./);
  assert.match(scrape, /recordSeen\(db, \{ today, sun, fox, ok \}\)/);
  assert.match(scrape, /gone: true, goneDate: old\.goneDate \|\| today/);
});
