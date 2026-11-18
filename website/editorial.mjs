// Editorial redesign for the homepage (Nov 2026).
// Runs on the freshly copied LIVE site (after mirror.mjs), so every word on the page
// stays exactly as it is live. It only rearranges the hero into:
//   porch-photo hero  ->  cream $900 band  ->  portrait + intro copy
// and adds editorial.css + the porch photos. Stops (no deploy) if the page doesn't
// look as expected or if any visible text would change. Safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS = ['hero-porch.jpg', 'hero-porch.webp', 'hero-porch-mobile.jpg', 'hero-porch-mobile.webp'];
const MARK = 'href="editorial.css"';

// Find the full element that starts at `start` (an opening <tag ...>), balancing nested same-name tags.
export function elementEnd(html, start, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  throw new Error(`unclosed <${tag}>`);
}

// The element whose opening tag matches `openRe` (searched from `from`), as {start, end, html}.
function find(html, openRe, tag, from = 0, to = html.length) {
  const re = new RegExp(openRe.source, 'gi');
  re.lastIndex = from;
  const m = re.exec(html);
  if (!m || m.index >= to) return null;
  const end = elementEnd(html, m.index, tag);
  return { start: m.index, end, html: html.slice(m.index, end) };
}

// Visible text, in order (scripts/styles skipped, whitespace collapsed).
export function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\u0000')
    .split('\u0000').map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function applyEditorial(html) {
  if (html.includes(MARK)) return { html, changed: false };

  const hero = find(html, /<section\b[^>]*class="hero"[^>]*>/, 'section');
  if (!hero) throw new Error('hero section not found');
  const copy = find(html, /<div\b[^>]*class="hero-copy"[^>]*>/, 'div', hero.start, hero.end);
  if (!copy) throw new Error('hero-copy not found');

  const pieces = {
    portrait: find(html, /<figure\b[^>]*class="hero-portrait"[^>]*>/, 'figure', copy.start, copy.end),
    eyebrow: find(html, /<p\b[^>]*class="fx-eyebrow"[^>]*>/, 'p', copy.start, copy.end),
    h1: find(html, /<h1\b[^>]*>/, 'h1', copy.start, copy.end),
    offer: find(html, /<div\b[^>]*class="hero-offer"[^>]*>/, 'div', copy.start, copy.end),
  };
  for (const [k, v] of Object.entries(pieces)) if (!v) throw new Error(`hero ${k} not found`);
  const portraitImg = pieces.portrait.html.match(/<img\b[^>]*>/i);
  if (!portraitImg) throw new Error('portrait image not found');

  // Everything else inside hero-copy, in its original order, becomes the intro copy.
  const openEnd = html.indexOf('>', copy.start) + 1;
  const closeStart = copy.end - '</div>'.length;
  const taken = Object.values(pieces).sort((a, b) => a.start - b.start);
  let rest = '', pos = openEnd;
  for (const p of taken) { rest += html.slice(pos, p.start); pos = p.end; }
  rest += html.slice(pos, closeStart);

  const newHero = `<!-- HERO (editorial) -->
    <section class="hero ed-hero">
      <picture class="ed-hero-bg">
        <source media="(max-width:760px)" srcset="assets/hero-porch-mobile.webp" type="image/webp" />
        <source media="(max-width:760px)" srcset="assets/hero-porch-mobile.jpg" />
        <source srcset="assets/hero-porch.webp" type="image/webp" />
        <img src="assets/hero-porch.jpg" width="1672" height="941" alt="" fetchpriority="high" decoding="async" />
      </picture>
      <div class="wrap ed-hero-inner">
        <div class="ed-hero-text">
          ${pieces.eyebrow.html}
          ${pieces.h1.html}
        </div>
      </div>
    </section>

    <!-- FLAT-FEE BAND -->
    <section class="ed-band" aria-label="Flat fee">
      <div class="wrap">
        ${pieces.offer.html}
      </div>
    </section>

    <!-- INTRO -->
    <section class="ed-intro">
      <div class="wrap ed-intro-grid">
        <figure class="ed-portrait">
          ${portraitImg[0]}
        </figure>
        <div class="ed-intro-copy">${rest}</div>
      </div>
    </section>`;

  let out = html.slice(0, hero.start) + newHero + html.slice(hero.end);
  const head = '<link rel="preload" as="image" href="assets/hero-porch.webp" media="(min-width:761px)" />\n' +
    '<link rel="preload" as="image" href="assets/hero-porch-mobile.webp" media="(max-width:760px)" />\n' +
    '<link rel="stylesheet" href="editorial.css" />\n</head>';
  if (!out.includes('</head>')) throw new Error('</head> not found');
  out = out.replace('</head>', head);

  // Hard stop if any visible word changed or moved.
  const a = visibleText(html), b = visibleText(out);
  if (a.length !== b.length || a.some((t, i) => t !== b[i])) throw new Error('visible text would change: not applying');
  return { html: out, changed: true };
}

// CLI: node website/editorial.mjs site
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'site';
  const page = path.join(dir, 'index.html');
  const { html, changed } = applyEditorial(fs.readFileSync(page, 'utf8'));
  if (changed) fs.writeFileSync(page, html);
  fs.copyFileSync(path.join(HERE, 'editorial', 'editorial.css'), path.join(dir, 'editorial.css'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const f of ASSETS) fs.copyFileSync(path.join(HERE, 'editorial', f), path.join(dir, 'assets', f));
  console.log(changed ? 'Editorial redesign applied to the homepage.' : 'Editorial redesign already on the page; refreshed its CSS and photos.');
}
