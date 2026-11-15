// Duplicate and gone-clock checks for the "other sellers" check. No network, no files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchKey, pickOthers, mergeHistory } from '../others.mjs';

test('address spellings of one home match', () => {
  const k = matchKey('709 Sutton St');
  for (const a of ['709 Sutton Street Lot 2504', '709 Sutton', '709 SUTTON ST.', '709 Sutton St, Lot #2504'])
    assert.equal(matchKey(a), k, a);
  assert.equal(matchKey('711 E. Norman Street'), matchKey('711 E Norman St'));
  assert.equal(matchKey('678 Cedar La'), matchKey('678 Cedar Lane'));
  assert.equal(matchKey('434 Watson Drive'), matchKey('434 Watson Dr'));
  assert.notEqual(matchKey('709 Sutton St'), matchKey('790 Sutton St'));
  assert.notEqual(matchKey('944 W Norman St'), matchKey('944 E Norman St'));
});

test('Sun, Foxfire, market.json homes and repeats are dropped', () => {
  const market = { homes: { a: { address: '508 Palmer Dr', source: 'Foxfire', gone: false },
                            b: { address: '120 W Pine St', source: 'Foxfire', gone: true } } };
  const feed = [
    { address: '201 Cottonwood Cir', sellerKey: '3211' },
    { address: '410 Palmer Dr', sellerKey: '23986' },
    { address: '508 Palmer Drive', sellerKey: '6089' },          // already in market.json
    { address: '709 Sutton Street Lot 2504', sellerKey: '27492' },
    { address: '709 Sutton St', sellerKey: '99999' },            // same home twice
    { address: '120 W Pine Street', sellerKey: '27492' },        // gone from Foxfire, now elsewhere: keep
    { address: '', sellerKey: '27492' }
  ];
  const { homes, dropped } = pickOthers(feed, market);
  assert.deepEqual(homes.map(h => h.address), ['709 Sutton Street Lot 2504', '120 W Pine Street']);
  assert.equal(dropped.length, 3);
});

test('a home is gone only after two clean misses', () => {
  const db = { homes: {} };
  const h = { address: '208 Magnolia Dr', matchKey: matchKey('208 Magnolia Dr'), price: 90000 };
  mergeHistory(db, [h], '2026-11-16');
  mergeHistory(db, [], '2026-11-17');
  assert.equal(db.homes[h.matchKey].gone, false);
  mergeHistory(db, [], '2026-11-18');
  assert.equal(db.homes[h.matchKey].gone, true);
  assert.equal(db.homes[h.matchKey].goneDate, '2026-11-18');
});

test('a partial read never starts or finishes the gone-clock', () => {
  const db = { homes: {} };
  const a = { address: '208 Magnolia Dr', matchKey: matchKey('208 Magnolia Dr'), price: 90000 };
  const b = { address: '709 Sutton St', matchKey: matchKey('709 Sutton St'), price: 70000 };
  mergeHistory(db, [a, b], '2026-11-16');
  mergeHistory(db, [a], '2026-11-17', { clean: false });
  assert.equal(db.homes[b.matchKey].firstAbsent, undefined);
  assert.equal(db.homes[b.matchKey].gone, false);
});
