// Site updates (Nov 18, 2026), run on the freshly copied LIVE site after mirror.mjs.
// 1) 2027 costs page: fee explanation, column + heading renames, mailbox-inclusive fee
//    total ($91.46), Back to Home button.
// 2) Header logo on every page uses the dark-lettered copy of the original logo
//    (made by dark_logo.py from the original file; only the white letters change).
// 3) Homepage cost strip "about $901 with fees" -> "about $902 with fees".
// Each change checks the page first and stops (no deploy) if the page is not as expected.
// Safe to re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sun Communities, "Water Oak Country Club Estates, Estimated Community Expenses 2027".
// Sun's flyer total of $90.46 covers the first three only; its footnote says the $1 mailbox
// rental is not included. All four are listed on the page, so the monthly total is $91.46.
export const FEES = [
  ['Real estate tax pass-on', 48.90],
  ['Fire &amp; rescue', 25.49],
  ['Curbside trash pickup', 16.07],
  ['Mailbox rental', 1.00],
];
export const FEE_TOTAL = Math.round(FEES.reduce((s, [, v]) => s + v, 0) * 100) / 100; // 91.46

const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DONE = 'class="back-home"';
const NOTE = 'In addition to your monthly lot rent, Water Oak charges separate fees for property taxes, fire and rescue services, trash collection, and mailbox rental. These charges are shown separately below so you can see your estimated monthly total.';

function must(cond, msg) { if (!cond) throw new Error(`costs page: ${msg}`); }

export function updateCostsPage(html) {
  if (html.includes(DONE)) return { html, changed: false };
  must(FEE_TOTAL === 91.46, 'fee items do not add up to 91.46');
  let out = html;

  // Fee items must still be the four Sun amounts.
  for (const [name, v] of FEES) must(out.includes(`<li>${name}: ${money(v)}</li>`), `fee item "${name}" not found`);

  // 1. Explanation above the table.
  const h2 = /(<h2>Monthly cost by lot type<\/h2>\s*)(<table>)/;
  must(h2.test(out), 'table heading not found');
  out = out.replace(h2, `$1<p class="plain fee-note">${NOTE}</p>\n$2`);

  // 2. Column heading.
  must(out.includes('<th>+ Fees</th>'), '"+ Fees" heading not found');
  out = out.replace('<th>+ Fees</th>', '<th>Additional fees</th>');

  // 3. Each row: fee cell + total recomputed from that row's lot rent.
  const row = /<td>\$([\d,]+\.\d\d)<\/td><td>\$90\.46<\/td><td class="t">\$([\d,]+\.\d\d)<\/td>/g;
  let rows = 0;
  out = out.replace(row, (m, rent, total) => {
    const r = Number(rent.replace(/,/g, '')), t = Number(total.replace(/,/g, ''));
    must(Math.abs(r + 90.46 - t) < 0.001, `row total ${total} does not match rent ${rent}`);
    rows++;
    return `<td>${money(r)}</td><td>${money(FEE_TOTAL)}</td><td class="t">${money(Math.round((r + FEE_TOTAL) * 100) / 100)}</td>`;
  });
  must(rows === 7, `expected 7 lot rows, found ${rows}`);

  // 4. Fee breakdown heading.
  must(out.includes('<h2>What the $90.46 covers</h2>'), 'fee breakdown heading not found');
  out = out.replace('<h2>What the $90.46 covers</h2>', '<h2>Additional Monthly Fees: What You’re Paying For</h2>');

  // 5. Callout under $811 (standard lot 811 + 91.46 = 902.46).
  must(out.includes('about $901 with fees'), 'callout "about $901 with fees" not found');
  out = out.replace('about $901 with fees', 'about $902 with fees');

  // 6. Back to Home button after the source note.
  const src = /(<div class="src">[\s\S]*?<\/div>)/;
  must(src.test(out), 'source note not found');
  out = out.replace(src, `$1\n<div class="back-home-wrap"><a ${DONE} href="/">&larr; Back to Home</a></div>`);
  must(out.includes('</head>'), '</head> not found');
  out = out.replace('</head>', `<style>
.wc .panel p.fee-note{margin:0 0 16px}
.wc .back-home-wrap{text-align:center;margin:30px 0 8px}
.wc a.back-home{display:inline-block;min-height:48px;box-sizing:border-box;padding:15px 30px;background:#183F32;color:#F6F1E7;border:1px solid #183F32;font-family:"Lexend","Helvetica Neue",Arial,sans-serif;font-weight:500;font-size:16px;letter-spacing:.14em;text-transform:uppercase;text-decoration:none;line-height:1.1}
.wc a.back-home:hover,.wc a.back-home:focus-visible{background:#F6F1E7;color:#183F32}
</style>
</head>`);

  must(!out.includes('90.46'), 'an old $90.46 is still on the page');
  return { html: out, changed: true };
}

export function useDarkHeaderLogo(html) {
  const re = /(<img\b[^>]*class="brand-a-logo"[^>]*src="[^"]*\/?assets\/)logo-wordmark\.png"/g;
  const out = html.replace(re, '$1logo-wordmark-dark.png"');
  return { html: out, changed: out !== html };
}

export function updateHomeCostStrip(html) {
  if (!html.includes('about $901 with fees')) return { html, changed: false };
  return { html: html.replace('about $901 with fees', 'about $902 with fees'), changed: true };
}

// 4) Emerald glass buttons on every page (stylesheet loaded last).
export function addGlassButtons(html) {
  const V = '/glass-buttons.css?v=4';
  if (html.includes(V) || !html.includes('</head>')) return { html, changed: false };
  if (html.includes('/glass-buttons.css')) return { html: html.replace(/\/glass-buttons\.css(\?v=\d+)?/, V), changed: true };
  const i = html.lastIndexOf('</head>');
  return { html: html.slice(0, i) + `<link rel="stylesheet" href="${V}" />\n` + html.slice(i), changed: true };
}

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

// CLI: node website/site-updates.mjs site
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || 'site';
  must(fs.existsSync(path.join(dir, 'assets', 'logo-wordmark-dark.png')), 'dark logo file missing');
  const costs = path.join(dir, 'water-oak-2027-costs', 'index.html');
  const c = updateCostsPage(fs.readFileSync(costs, 'utf8'));
  if (c.changed) fs.writeFileSync(costs, c.html);
  console.log(c.changed ? 'Costs page updated.' : 'Costs page already updated.');
  const home = path.join(dir, 'index.html');
  const h = updateHomeCostStrip(fs.readFileSync(home, 'utf8'));
  if (h.changed) fs.writeFileSync(home, h.html);
  fs.copyFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'editorial', 'glass-buttons.css'), path.join(dir, 'glass-buttons.css'));
  let n = 0, g = 0;
  for (const f of htmlFiles(dir)) {
    const before = fs.readFileSync(f, 'utf8');
    const a = useDarkHeaderLogo(before), b = addGlassButtons(a.html);
    if (a.changed) n++;
    if (b.changed) g++;
    if (b.html !== before) fs.writeFileSync(f, b.html);
  }
  console.log(`Dark header logo on ${n} page(s); glass buttons on ${g} page(s).`);
}
