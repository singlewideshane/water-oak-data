// Sun's own page: card parsing, the Homes Found control, and address matching.
// Never writes data/market.json and does not open a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyOf, recordSeen, repeatedCuts, sourceStatus } from '../market.mjs';
import { acceptSunRead, parseSunCard } from '../sunpage.mjs';

const PAGE = 'https://www.suncommunities.com/florida/water-oak-country-club-estates/find-a-home';

function card({ badge = '', price, spec, address, href }) {
  return {
    badge,
    price,
    lines: [spec, address].filter(Boolean),
    href: href || ''
  };
}

function bemen(over = {}) {
  return card({
    badge: 'UNDER CONTRACT',
    price: '$59,000*',
    spec: '2 beds | 2 baths | 768 sqft | Site: #WAT-2007',
    address: '413 Bemen Dr , Lady Lake, FL, 32159',
    href: PAGE + '/59215-413-bemen-dr-32159',
    ...over
  });
}

test('lot and site words are not part of the address match', () => {
  assert.equal(keyOf('413 Bemen Dr Lot 2504'), keyOf('413 Bemen Dr'));
  assert.equal(keyOf('413 Bemen Dr, Lot No. 2504'), '413 bemen dr');
  assert.equal(keyOf('805 Sutton St Site #WAT-2782'), keyOf('805 Sutton St'));
  assert.equal(keyOf('214 Birch St, Site: #WAT-0293'), '214 birch st');
  assert.equal(keyOf('2 Elm Drive'), '2 elm dr');
  assert.equal(keyOf('494 Sheehan Way'), '494 sheehan way');
});

test('a Sun card keeps the street, the price, the site number, and the status badge', () => {
  const home = parseSunCard(bemen());
  assert.equal(home.address, '413 Bemen Dr');
  assert.equal(home.price, 59000);
  assert.equal(home.site, 'WAT-2007');
  assert.equal(home.pending, true);
  assert.equal(home.beds, 2);
  assert.equal(home.baths, 2);
  assert.equal(home.sqft, 768);
  assert.equal(home.source, 'Sun');
  assert.equal(home.key, undefined);
  assert.equal(keyOf(home.address), '413 bemen dr');

  const hill = parseSunCard(card({
    price: '$69,000*',
    spec: '2 beds | 2 baths | 1040 sqft | Site: #WAT-0373',
    address: '644 Hickory Hill , Lady Lake, FL, 32159'
  }));
  assert.equal(hill.address, '644 Hickory Hill');
  assert.equal(hill.pending, false);
  assert.equal(keyOf(hill.address), '644 hickory hill');
});

test('only under contract and sale pending are pending', () => {
  const badges = {
    'UNDER CONTRACT': true,
    'SALE PENDING': true,
    'Sale Pending': true,
    'DEAL OF THE MONTH': false,
    'FEATURED': false,
    'NEW LISTING': false,
    '2 YRS SITE RENT INCLUDED': false,
    '': false
  };
  for (const [badge, pending] of Object.entries(badges)) {
    const home = parseSunCard(bemen({ badge, address: '100 Oak St , Lady Lake, FL, 32159' }));
    assert.equal(home.pending, pending, badge || '(none)');
  }
});

test('a lot suffix is the same home, and a missing Sun home is not sold on the first miss', () => {
  const db = {
    version: 3, started: '2026-10-04', updated: null, runs: [{}], homes: {
      '413 bemen dr': {
        key: '3501969', source: 'Sun', address: '413 Bemen Dr', price: 59000,
        pending: false, url: 'https://www.mhvillage.com/homes/3501969',
        firstSeen: '2026-10-04', lastSeen: '2026-11-13', onAtStart: true,
        prices: [{ date: '2026-10-04', price: 59000 }], gone: false, goneDate: null
      },
      '923 e norman st': {
        key: '3553227', source: 'Sun', address: '923 E Norman St', price: 68900,
        pending: false, url: 'https://www.mhvillage.com/homes/3553227',
        firstSeen: '2026-10-04', lastSeen: '2026-11-13', onAtStart: true,
        prices: [{ date: '2026-10-04', price: 68900 }], gone: false, goneDate: null
      }
    },
    seen: { Sun: { date: '2026-11-13', ids: ['413 bemen dr', '923 e norman st'] } }
  };
  const seen = parseSunCard(bemen({ address: '413 Bemen Dr Lot 2504' }));
  assert.equal(seen.address, '413 Bemen Dr');
  const fox = [{ source: 'Foxfire', address: '3 Pine Dr', price: 1, pending: false, url: 'https://foxfiremanufactured.com/HomedetailCustom.asp?id=1' }];
  const ok = sourceStatus(db, [seen], fox);
  assert.equal(ok.Sun, true);
  recordSeen(db, { today: '2026-11-16', sun: [seen], fox, ok });
  const bemenRow = db.homes['413 bemen dr'];
  assert.equal(bemenRow.pending, true);
  assert.equal(bemenRow.key, '3501969');
  assert.equal(bemenRow.firstSeen, '2026-10-04');
  assert.equal(bemenRow.gone, false);
  assert.equal(bemenRow.site, 'WAT-2007');
  assert.equal(Object.keys(db.homes).filter(k => k.includes('bemen')).length, 1);
  const norman = db.homes['923 e norman st'];
  assert.equal(norman.gone, false);
  assert.equal(norman.goneDate, null);
  assert.equal(norman.firstAbsent, '2026-11-16');
  assert.equal(norman.key, '3553227');

  const paused = JSON.parse(JSON.stringify(db.seen.Sun));
  const failed = acceptSunRead(29, [bemen()]);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.homes, []);
  assert.match(failed.reason, /29 Homes Found but 1 card loaded/);
  recordSeen(db, { today: '2026-11-19', sun: null, fox, ok: { Sun: false, Foxfire: true } });
  assert.equal(db.homes['923 e norman st'].gone, false);
  assert.equal(db.homes['923 e norman st'].firstAbsent, '2026-11-16');
  assert.deepEqual(db.seen.Sun, paused);
});

test('repeated DOM cards still have to match the Homes Found total', () => {
  const extra = card({
    badge: 'SALE PENDING',
    price: '$63,500*',
    spec: '2 beds | 2 baths | 768 sqft | Site: #WAT-0293',
    address: '214 Birch St , Lady Lake, FL, 32159'
  });
  const dup = acceptSunRead(2, [bemen(), extra, bemen(), extra]);
  assert.equal(dup.ok, true);
  assert.equal(dup.homes.length, 2);
  assert.equal(dup.homes.filter(h => h.pending).length, 2);

  const short = acceptSunRead(29, [bemen(), extra]);
  assert.equal(short.ok, false);
  assert.deepEqual(short.homes, []);
  assert.match(short.reason, /not|but/);

  const unread = acceptSunRead(null, [bemen()]);
  assert.equal(unread.ok, false);
  assert.deepEqual(unread.homes, []);
  assert.match(unread.reason, /could not read Sun website/);
});

test('a later copy can mark the home pending, and the old key stays the stable id', () => {
  const plain = bemen({ badge: '' });
  const marked = bemen({ badge: 'Sale Pending' });
  const read = acceptSunRead(1, [plain, marked]);
  assert.equal(read.ok, true);
  assert.equal(read.homes[0].pending, true);

  const rows = repeatedCuts([{
    source: 'Sun', address: '413 Bemen Dr', key: '3501969', site: 'WAT-2007',
    url: 'https://www.suncommunities.com/florida/water-oak-country-club-estates/59215-413-bemen-dr-32159',
    gone: false,
    prices: [
      { date: '2026-10-01', price: 100000 },
      { date: '2026-10-11', price: 90000 },
      { date: '2026-10-31', price: 80000 }
    ]
  }], '2026-11-13');
  assert.equal(rows[0].stableId, '3501969');

  const newer = repeatedCuts([{
    source: 'Sun', address: '100 Oak St', site: 'WAT-9999',
    url: 'https://www.suncommunities.com/florida/water-oak-country-club-estates/1-100-oak-st-32159',
    gone: false,
    prices: [
      { date: '2026-10-01', price: 100000 },
      { date: '2026-10-11', price: 90000 },
      { date: '2026-10-31', price: 80000 }
    ]
  }], '2026-11-13');
  assert.equal(newer[0].stableId, 'WAT-9999');
});
