// Repeated asking-price cuts. Reads data/market.json; never writes it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { repeatedCuts } from '../market.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketPath = path.join(root, 'data/market.json');

function home(over) {
  return {
    source: 'Sun', address: '1 Oak St', key: '100', gone: false, goneDate: null,
    url: 'https://www.mhvillage.com/homes/100',
    prices: [
      { date: '2026-10-01', price: 100000 },
      { date: '2026-10-11', price: 90000 },
      { date: '2026-10-31', price: 80000 }
    ],
    ...over
  };
}

test('two step-downs 20 days apart qualify, with dollars from first to current', () => {
  const h = home({
    source: 'Foxfire', address: '434 Watson Drive', key: undefined,
    url: 'https://foxfiremanufactured.com/HomedetailCustom.asp?id=27243'
  });
  const before = JSON.stringify(h);
  const rows = repeatedCuts([h], '2026-11-13');
  assert.equal(JSON.stringify(h), before);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    address: '434 Watson Drive',
    source: 'Foxfire',
    stableId: '27243',
    originalAsk: 100000,
    currentAsk: 80000,
    reductionCount: 2,
    totalDollars: 20000,
    percent: 0.2,
    status: 'active',
    dom: null
  });
});

test('one step-down does not qualify', () => {
  const h = home({
    prices: [
      { date: '2026-10-01', price: 100000 },
      { date: '2026-10-21', price: 90000 }
    ]
  });
  assert.deepEqual(repeatedCuts([h], '2026-11-13'), []);
});

test('two step-downs 70 days apart do not qualify', () => {
  const h = home({
    prices: [
      { date: '2026-10-01', price: 100000 },
      { date: '2026-10-02', price: 90000 },
      { date: '2026-12-11', price: 80000 }
    ]
  });
  assert.equal((Date.parse('2026-12-11') - Date.parse('2026-10-02')) / 86400000, 70);
  assert.deepEqual(repeatedCuts([h], '2026-12-11'), []);
});

test('a step-down exactly 60 days after another qualifies', () => {
  const h = home({
    prices: [
      { date: '2026-10-01', price: 100000 },
      { date: '2026-10-02', price: 90000 },
      { date: '2026-12-01', price: 80000 }
    ]
  });
  assert.equal((Date.parse('2026-12-01') - Date.parse('2026-10-02')) / 86400000, 60);
  const rows = repeatedCuts([h], '2026-12-01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reductionCount, 2);
  assert.equal(rows[0].status, 'active');
});

test('a home with a first absence stays listed and is not marked gone', () => {
  const h = home({ firstAbsent: '2026-11-12', gone: false, goneDate: null });
  const rows = repeatedCuts([h], '2026-11-13');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'firstAbsent');
  assert.equal(rows[0].dom, null);
  assert.notEqual(rows[0].status, 'gone');
});

test('a home already marked gone keeps that status', () => {
  const h = home({ gone: true, goneDate: '2026-11-13' });
  const rows = repeatedCuts([h], '2026-11-13');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'gone');
});

test('prices after asOf are ignored', () => {
  const h = home();
  assert.deepEqual(repeatedCuts([h], '2026-10-11'), []);
  const rows = repeatedCuts([h], '2026-10-31');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].currentAsk, 80000);
});

test('stored market history has no home cut twice within 60 days', () => {
  const bytes = fs.readFileSync(marketPath);
  const db = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(repeatedCuts(db.homes, db.updated), []);
  assert.ok(fs.readFileSync(marketPath).equals(bytes), 'data/market.json was not written');
});

test('the scan writes the cuts file and the workflow commits it', () => {
  const scrape = fs.readFileSync(path.join(root, 'scrape.mjs'), 'utf8');
  const yml = fs.readFileSync(path.join(root, '.github/workflows/market.yml'), 'utf8');
  assert.match(scrape, /const cuts = repeatedCuts\(db\.homes, today\)/);
  assert.match(scrape, /data\/repeated_cuts\.json/);
  assert.match(yml, /git add data\/market\.json list-to-sold\/to_check\.csv data\/repeated_cuts\.json/);
});
