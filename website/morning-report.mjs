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
if (lastO && lastO.status !== 'ok') notes.push(`MHVillage not checked ${lastO.date}`);
out.push(`Checked: sales office/RE/MAX ${lastM?.date || '?'}${lastO ? ` · other brokers ${lastO.date}` : ''}${notes.length ? ' · ' + notes.join(' · ') : ''}`);
console.log(out.join('\n'));
