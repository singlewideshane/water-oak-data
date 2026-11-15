// Prints the 5am Water Oak morning report (plain text). Read-only.
import fs from 'node:fs';
import { collect, csvRows } from './build-market.mjs';

const read = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d;
const market = read('data/market.json', { homes: {}, runs: [] });
const others = read('data/other_sellers.json', { homes: {}, runs: [] });
const stats = read('data/stats.json', { listings: [] });
const manual = fs.existsSync('data/fsbo_manual.csv') ? csvRows(fs.readFileSync('data/fsbo_manual.csv', 'utf8')) : [];
const homes = collect({ market, others, stats, manual });

const GROUP = { Sun: 'Sales office', Foxfire: 'RE/MAX', MHVillage: 'Other brokers', Shane: 'Owners (FSBO)' };
const group = h => GROUP[h.source] || 'Owners (FSBO)';
const order = ['Sales office', 'RE/MAX', 'Other brokers', 'Owners (FSBO)'];
const forSale = homes.filter(h => !h.pending), pending = homes.filter(h => h.pending);
const $ = p => p ? '$' + Number(p).toLocaleString('en-US') : 'no price';

const out = ['Good morning. Here\'s your Water Oak report.', '', `${forSale.length} homes for sale`];
for (const g of order) out.push(`${g}: ${forSale.filter(h => group(h) === g).length}`);
out.push(`Under contract: ${pending.length}`);
const lastM = (market.runs || []).at(-1), lastO = (others.runs || []).at(-1);
const notes = [];
const days = d => d ? Math.floor((Date.now() - Date.parse(d)) / 86400000) : 99;
if (days(lastM?.date) > 5) notes.push(`RE/MAX numbers are ${days(lastM?.date)} days old`);
if (!lastO || days(lastO.date) > 2) notes.push('MHVillage not checked in 2+ days');
const cutoff = new Date(Date.now() - 23 * 86400000).toISOString().slice(0, 10);
const aging = manual.filter(r => r.date_seen && r.date_seen < cutoff).length;
if (aging) notes.push(`${aging} owner listing(s) need rechecking soon`);
if (lastO && lastO.status === 'not checked') notes.push('MHVillage could not be read today');
if (notes.length) out.push('', 'Heads up: ' + notes.join('; ') + '.');
console.log(out.join('\n'));
