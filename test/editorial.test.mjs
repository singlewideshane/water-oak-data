import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { applyEditorial, visibleText } from '../website/editorial.mjs';

const page = fs.readFileSync(new URL('./fixtures/site-index.html', import.meta.url), 'utf8');

test('rebuilds the hero without changing a single visible word', () => {
  const { html, changed } = applyEditorial(page);
  assert.equal(changed, true);
  assert.deepEqual(visibleText(html), visibleText(page));
  assert.match(html, /class="hero ed-hero"/);
  assert.match(html, /class="ed-band"[\s\S]*\$900<\/strong> flat fee/);
  assert.doesNotMatch(html, /shane-walker-tight\.webp/);
  assert.match(html, /<link rel="stylesheet" href="editorial.css" \/>\n<\/head>/);
  assert.equal((html.match(/class="hero-portrait"/g) || []).length, 0);
});

test('keeps links, forms, tracking and scripts as they were', () => {
  const { html } = applyEditorial(page);
  const hrefs = s => (s.match(/href="[^"]*"/g) || []).filter(h => !/editorial\.css|hero-porch/.test(h)).sort();
  assert.deepEqual(hrefs(html), hrefs(page));
  const scripts = s => s.match(/<script[\s\S]*?<\/script>/g);
  assert.deepEqual(scripts(html), scripts(page));
  assert.deepEqual(html.match(/<form[^>]*>/g), page.match(/<form[^>]*>/g));
  assert.match(html, /G-D3LJPYPN20/);
});

test('takes the portrait off a page that already has the redesign', () => {
  const old = applyEditorial(page).html.replace('<div class="ed-intro-copy">', '<figure class="ed-portrait">\n<img src="assets/shane-walker-tight.webp" alt="Shane Fuller" />\n</figure>\n<div class="ed-intro-copy">');
  const { html, changed } = applyEditorial(old);
  assert.equal(changed, true);
  assert.doesNotMatch(html, /ed-portrait|shane-walker-tight/);
  assert.deepEqual(visibleText(html), visibleText(old));
});

test('safe to run twice', () => {
  const once = applyEditorial(page).html;
  const twice = applyEditorial(once);
  assert.equal(twice.changed, false);
  assert.equal(twice.html, once);
});

test('stops instead of guessing when the hero is different', () => {
  assert.throws(() => applyEditorial(page.replace('class="hero"', 'class="intro"')), /hero section not found/);
  assert.throws(() => applyEditorial(page.replace('class="hero-offer"', 'class="offer"')), /hero offer not found/);
});

test('works with the live bio wording from Nov 16', () => {
  const live = page.replace('<p class="fx-flow">', '<p class="fx-flow">I bring real estate experience from my years as a Texas Realtor. ');
  const { html } = applyEditorial(live);
  assert.deepEqual(visibleText(html), visibleText(live));
  assert.match(html, /class="ed-intro-copy">[\s\S]*Texas Realtor/);
});
