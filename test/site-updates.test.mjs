import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { updateCostsPage, useDarkHeaderLogo, updateHomeCostStrip, FEE_TOTAL } from '../website/site-updates.mjs';
import { visibleText } from '../website/editorial.mjs';

const page = fs.readFileSync(new URL('./fixtures/costs-index.html', import.meta.url), 'utf8');

test('fee items add up to $91.46', () => assert.equal(FEE_TOTAL, 91.46));

test('costs page: every number agrees with $91.46', () => {
  const { html, changed } = updateCostsPage(page);
  assert.equal(changed, true);
  assert.doesNotMatch(html, /90\.46/);
  for (const [rent, total] of [['811.00', '902.46'], ['845.00', '936.46'], ['895.00', '986.46'], ['939.00', '1,030.46'],
    ['860.00', '951.46'], ['882.00', '973.46'], ['946.00', '1,037.46']]) {
    assert.match(html, new RegExp(`<td>\\$${rent}</td><td>\\$91\\.46</td><td class="t">\\$${total.replace(',', ',')}</td>`));
  }
  assert.match(html, /about \$902 with fees/);
});

test('costs page: new wording in the right places', () => {
  const { html } = updateCostsPage(page);
  assert.match(html, /<h2>Monthly cost by lot type<\/h2>\s*<p class="plain fee-note">In addition to your monthly lot rent, Water Oak charges separate fees for property taxes, fire and rescue services, trash collection, and mailbox rental\. These charges are shown separately below so you can see your estimated monthly total\.<\/p>\s*<table>/);
  assert.match(html, /<th>Additional fees<\/th>/);
  assert.match(html, /<h2>Additional Monthly Fees: What You’re Paying For<\/h2>/);
  assert.match(html, /<div class="src">[\s\S]*?<\/div>\n<div class="back-home-wrap"><a class="back-home" href="\/">&larr; Back to Home<\/a><\/div>/);
});

test('costs page: nothing else changes', () => {
  const { html } = updateCostsPage(page);
  const strip = s => visibleText(s).join('\n')
    .replace(/In addition to your monthly lot rent[^\n]*\n/, '')
    .replace('Additional fees', '+ Fees')
    .replace('Additional Monthly Fees: What You’re Paying For', 'What the $90.46 covers')
    .replace('about $902 with fees', 'about $901 with fees')
    .replace(/\$91\.46/g, '$90.46')
    .replace('\n&larr; Back to Home', '')
    .replace(/\$(902|936|986|951|973)\.46/g, (m, n) => `$${n - 1}.46`)
    .replace('$1,030.46', '$1,029.46').replace('$1,037.46', '$1,036.46');
  assert.equal(strip(html), visibleText(page).join('\n'));
  const links = s => (s.match(/href="[^"]*"/g) || []).filter(h => h !== 'href="/"');
  assert.deepEqual(links(html), links(page));
});

test('costs page: safe to run twice, stops on unexpected page', () => {
  const once = updateCostsPage(page).html;
  assert.equal(updateCostsPage(once).changed, false);
  assert.throws(() => updateCostsPage(page.replace('$16.07', '$16.08')), /fee item/);
  assert.throws(() => updateCostsPage(page.replace('<td>$90.46</td><td class="t">$901.46</td>', '<td>$90.46</td><td class="t">$905.46</td>')), /does not match/);
});

test('header logo swaps to the dark copy; footer logo stays', () => {
  const h = '<img class="brand-a-logo" src="/assets/logo-wordmark.png" alt="SingleWideShane" width="1229" height="368" />' +
    '<img class="footer-a-logo" src="/assets/logo-wordmark.png" alt="" />';
  const { html } = useDarkHeaderLogo(h);
  assert.match(html, /class="brand-a-logo" src="\/assets\/logo-wordmark-dark\.png"/);
  assert.match(html, /class="footer-a-logo" src="\/assets\/logo-wordmark\.png"/);
  assert.equal(useDarkHeaderLogo(html).changed, false);
});

test('homepage cost strip matches the costs page', () => {
  assert.equal(updateHomeCostStrip('for a standard lot, about $901 with fees.').html, 'for a standard lot, about $902 with fees.');
});
