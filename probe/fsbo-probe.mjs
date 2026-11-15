// ONE-TIME PROBE. Reads MHVillage's Water Oak feed (park 6059) and prints each
// listing's seller type. Saves nothing. Owner names/phones are never printed.
import fs from 'node:fs';
const MHV = 'https://www.mhvillage.com';
const HEAD = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8' };
async function get(url, json) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: HEAD }); if (r.ok) return json ? await r.json() : await r.text(); console.log('HTTP', r.status, url); }
    catch (e) { console.log('fetch error', url, e.message); }
    await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}
const text = h => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

const items = [];
let readOk = true;
for (let off = 0; off < 600; off += 60) {
  const j = await get(`${MHV}/api/v1/listings.json?offset=${off}&limit=60&order[]=best-match:asc&radius=0&active-sold[]=2&park-key=6059&active[]=1&include[]=detailsStd`, true);
  if (!j) { readOk = false; break; }
  const list = j.payload || j.data || [];
  items.push(...list);
  if (list.length < 60) break;
}
const out = [];
out.push(`MHVillage feed read: ${readOk ? 'OK' : 'FAILED'} | listings: ${items.length}`);
if (items[0]) {
  out.push('Listing fields: ' + Object.keys(items[0]).join(', '));
  out.push('Attribute fields: ' + Object.keys(items[0].attributes || {}).join(', '));
  out.push('Relationship fields: ' + Object.keys(items[0].relationships || {}).join(', '));
  const sc = items[0].relationships?.salesCenter;
  out.push('salesCenter fields: ' + (sc ? Object.keys(sc).join(', ') : 'none'));
}
const rows = [];
for (const it of items) {
  const key = String(it.key || it.id);
  const html = await get(`${MHV}/homes/${key}`) || '';
  const t = text(html);
  const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/&amp;/g, '&');
  const addr = (title.match(/(\d{1,5} [^|>,]+?),?\s*Lady Lake/i) || [])[1] || '?';
  const label = (t.match(/For Sale By (Owner|Community|Dealer|Agent|Broker|Retailer|Lender|Bank|[A-Z][a-z]+)/) || [])[0] || 'no label';
  const listedBy = label === 'For Sale By Owner' ? '(owner — name hidden)'
    : ((t.match(/Listed by:\s*([^:]{2,60}?)(?:\s{2,}|Member|For Sale|MHVillage|View|Follow|License)/i) || [])[1] || '?').trim();
  const sc = it.relationships?.salesCenter;
  const scKey = sc?.key ?? 'none';
  const pending = /sale pending/i.test(t) ? 'PENDING' : '';
  const extra = Object.entries(it.attributes || it).filter(([k, v]) => /owner|seller|fsbo|type|private/i.test(k) && (typeof v !== 'object')).map(([k, v]) => `${k}=${v}`).join(' ');
  rows.push({ key, addr, scKey, label, listedBy, pending, extra });
}
const groups = {};
for (const r of rows) { const g = `${r.scKey} | ${r.label} | ${r.listedBy}`; groups[g] = (groups[g] || 0) + 1; }
out.push('', 'BY SELLER (salesCenter key | page label | listed by): count');
for (const [g, c] of Object.entries(groups).sort((a, b) => b[1] - a[1])) out.push(`${g}: ${c}`);
out.push('', 'EVERY LISTING:');
for (const r of rows) out.push(`${r.key} | ${r.addr} | sc ${r.scKey} | ${r.label} | ${r.listedBy} ${r.pending} ${r.extra}`);
const report = out.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');
// Short version as annotations, so the result is readable without logging in.
for (const line of out.slice(0, 6)) console.log('::notice title=probe::' + line.replace(/\n/g, ' '));
for (const [g, c] of Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`::notice title=seller::${g}: ${c}`);
