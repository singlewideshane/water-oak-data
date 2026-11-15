import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collect, build, csvRows } from '../website/build-market.mjs';

test('each home counted once; pending removed; fields match the site', () => {
  const market = { homes: {
    a: { address: '709 Sutton St', price: 70000, source: 'Sun', gone: false },
    b: { address: '410 Palmer Dr', price: 189900, source: 'Foxfire', gone: false, pending: true },
    c: { address: '120 W Pine St', price: 49900, source: 'Foxfire', gone: true } } };
  const others = { homes: { x: { address: '709 Sutton Street Lot 2504', price: 77777, status: 'active', gone: false },
                            y: { address: '208 Magnolia Drive', price: 64900, status: 'active', gone: false } },
                   pendingOnMhv: { addresses: ['709 Sutton St'] } };
  const stats = { listings: [{ address: '916 E Norman St.', status: 'active', listPrice: 84900, priceHistory: [] },
                             { address: '725 Sutton St', status: 'sold', listPrice: 87400 }] };
  const manual = csvRows('address,price,status\n"739 Sutton St","$65,000",active\n916 E Norman St,84900,active\n');
  const homes = collect({ market, others, stats, manual });
  assert.equal(homes.length, 5);
  const out = build(homes, null, '2026-11-20');
  assert.equal(out.total_for_sale, 3);
  assert.equal(out.pending_or_under_contract, 2);
  assert.deepEqual(out.price_range, [64900, 84900]);
  assert.equal(out.median_ask, 65000);
  assert.deepEqual(Object.keys(out), ['updated', 'total_for_sale', 'total_for_sale_explainer', 'pending_or_under_contract',
    'stats_basis', 'median_ask', 'price_range', 'price_bands', 'whats_moving', 'takeaway']);
});

test("what's moving compares with last week", () => {
  const prev = { date: '2026-11-13', homes: { '1 a': { price: 50000, pending: false }, '2 b': { price: 90000, pending: false } } };
  const out = build([{ key: '2 b', price: 90000, pending: true }], prev, '2026-11-20');
  assert.deepEqual(out.whats_moving, { since: '2026-11-13', went_pending_count: 1, went_pending_range: [90000, 90000],
    left_list_count: 1, left_list_range: [50000, 50000] });
});
