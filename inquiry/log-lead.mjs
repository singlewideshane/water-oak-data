// Logs one emailed buyer inquiry as +1 call in data/log.json for the Listings app.
// Usage: node inquiry/log-lead.mjs "<listing address>" <YYYY-MM-DD> <gmailThreadId>
// No buyer names, emails or phones are ever written (this repo is public).
// Safe to run twice for the same thread: the second run does nothing.
import fs from 'node:fs';

const [addr, date, threadId] = process.argv.slice(2);
if (!addr || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !threadId) {
  console.error('usage: node inquiry/log-lead.mjs "<address>" YYYY-MM-DD <threadId>');
  process.exit(1);
}

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// Listings come from the app's own stats.json, so new listings work with no edit here.
// Key = house number + street name (skipping N/S/E/W), e.g. "916 norman".
const DIRS = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west']);
const keyOf = a => { const t = norm(a).split(' '); const st = t.slice(1).find(w => !DIRS.has(w)); return st ? `${t[0]} ${st}` : null; };
const stats = JSON.parse(fs.readFileSync('data/stats.json', 'utf8'));
const want = keyOf(addr);
const s = stats.listings.find(l => keyOf(l.address) === want);
if (!want || !s) { console.log(`no listing match for "${addr}", nothing logged`); process.exit(0); }
const label = s.address.replace(/\.$/, '').replace(/\s+(St|Ln|Dr|Rd|Ave|Ct|Way|Cir|Blvd)$/i, '');
const hit = { key: want, label, slug: want.split(' ')[1] };

const logPath = 'data/log.json';
const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
const id = `${date}-${hit.slug}-email-${threadId}`;
if (log.entries.some(e => e.id === id)) { console.log(`already logged: ${id}`); process.exit(0); }

// Current total for that day = the higher of what the app last reported and what's already queued in log.json.
const fromApp = Number(s?.calls?.[date] || 0);
const queued = log.entries.filter(e => e.date === date && keyOf(e.listing) === hit.key && typeof e.calls === 'number').map(e => e.calls);
const fromLog = queued.length ? queued.at(-1) : 0;
const calls = Math.max(fromApp, fromLog) + 1;

log.entries.push({ id, date, listing: hit.label, calls });
fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
console.log(`logged ${hit.label} ${date}: calls now ${calls}`);
