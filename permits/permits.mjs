// VERSION 2 — TOWN OF LADY LAKE (Nov 1). Water Oak permits live with the Town, not the county.
// Searches the Town's Citizenserve portal street by street, keeps every permit in permits/permits.csv,
// lists new ones since last run in permits/new.csv, and builds permits/by_address.csv
// (latest roof, AC, and set/build date per home).
import fs from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npm i --no-save --no-audit --no-fund playwright', { stdio: 'inherit' });
execSync('npx playwright install --with-deps chromium', { stdio: 'inherit' });
const { chromium } = await import('playwright');

const DIR = 'permits';
const SEARCH = 'https://www6.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=383&original_iid=0&original_contactID=0';
const streets = fs.readFileSync(DIR + '/streets.txt', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const today = new Date().toISOString().slice(0, 10);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 900 }, locale: 'en-US'
});
const page = await ctx.newPage();

const readRows = () => page.$$eval('main tr', trs => trs.map(tr => [...tr.cells].map(c => c.innerText.trim())).filter(r => r.length >= 7 && r[0] !== 'Permit#'));

async function searchStreet(name) {
  await page.goto(SEARCH, { waitUntil: 'networkidle', timeout: 90000 });
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /^Permits$/.test(o.text)));
    const o = [...s.options].find(o => /^Permits$/.test(o.text));
    s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  await page.fill('#address', name);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 90000 }).catch(() => {}),
    page.evaluate(() => [...document.querySelectorAll('button')].find(b => /submit/i.test(b.innerText) && b.offsetParent).click())
  ]);
  await page.waitForTimeout(2000);
  const body = await page.innerText('main');
  const m = body.match(/of (\d+) records found/);
  const total = m ? +m[1] : 0;
  let rows = await readRows();
  for (let start = 30; start < total; start += 30) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 90000 }).catch(() => {}),
      page.evaluate(([a, b]) => window.displayResultNPagging(String(a), String(b)), [start, start + 30])
    ]);
    await page.waitForTimeout(1500);
    rows = rows.concat(await readRows());
  }
  return { total, rows };
}

const key = r => r[0] + '|' + r[1];
const csvq = v => '"' + String(v ?? '').replace(/"/g, '""').replace(/\s+/g, ' ') + '"';
const FILE = DIR + '/permits.csv';
const HEAD = ['permit', 'address', 'type', 'subtype', 'status', 'issued', 'description', 'first_seen'];

const old = new Map();
if (fs.existsSync(FILE)) {
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n').slice(1);
  for (const l of lines) {
    const cols = [...l.matchAll(/"((?:[^"]|"")*)"/g)].map(x => x[1].replace(/""/g, '"'));
    old.set(cols[0] + '|' + cols[1], cols);
  }
}

const all = new Map(old);
const fresh = [];
const log = [];
for (const st of streets) {
  try {
    const { total, rows } = await searchStreet(st);
    // keep only addresses on this exact street (drops e.g. PALMER when searching PALM)
    const re = new RegExp('^\\d+[A-Z]?\\s+(EAST |WEST |E |W )?' + st.toUpperCase().replace(/ /g, '\\s+') + '(\\s+(ST|STREET|LN|LANE|DR|DRIVE|WAY|CT|COURT|CIR|CIRCLE|SQ|SQUARE|BLVD|LP|LOOP|RD|PL|TER|TRL|AVE))?\\b', 'i');
    const mine = rows.filter(r => re.test(r[1]));
    for (const r of mine) {
      const k = key(r);
      const rec = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], old.get(k)?.[7] || today];
      if (!old.has(k)) fresh.push(rec);
      all.set(k, rec);
    }
    log.push(`${st}: ${mine.length} of ${total}`);
    console.log(st, mine.length, 'of', total);
  } catch (e) { log.push(`${st}: ERROR ${String(e).slice(0, 120)}`); console.log(st, 'ERROR', e.message); }
}
await browser.close();

const d = s => { const [m, dd, y] = (s || '').split('/'); return y ? `${y}-${m}-${dd}` : ''; };
const sorted = [...all.values()].sort((a, b) => d(b[5]).localeCompare(d(a[5])));
fs.writeFileSync(FILE, HEAD.join(',') + '\n' + sorted.map(r => r.map(csvq).join(',')).join('\n') + '\n');
const isFirstRun = old.size === 0;
fs.writeFileSync(DIR + '/new.csv', HEAD.join(',') + '\n' + (isFirstRun ? '' : fresh.map(r => r.map(csvq).join(',')).join('\n')) + '\n');

// per-home summary: latest roof, latest AC, home set date
const norm = a => a.toUpperCase().replace(/\bEAST\b/, 'E').replace(/\bWEST\b/, 'W').replace(/\s+/g, ' ').trim();
const homes = new Map();
for (const r of sorted) {
  const a = norm(r[1]); const h = homes.get(a) || { roof: '', ac: '', set: '', open: [] };
  const t = (r[3] + ' ' + r[6]).toUpperCase();
  const when = d(r[5]);
  if (/ROOF/.test(t) && !/PAN ROOF|SCREEN/.test(t) && when > (h.roof.split(' ')[0] || '')) h.roof = `${when} ${/METAL/.test(t) ? 'metal' : 'shingle'}`;
  if (/MECHANICAL|HVAC|A\/C|HEAT ?PUMP|PKG|PACKAGE/.test(t) && when > (h.ac || '')) h.ac = when;
  if (/MANUFACTURED|NEW MFG|NEW MOBILE|NEW MH/.test(t) && (!h.set || when < h.set)) h.set = when;
  if (/EXPIRED/i.test(r[4])) h.open.push(`${r[0]} ${r[3]} ${when}`);
  homes.set(a, h);
}
fs.writeFileSync(DIR + '/by_address.csv', 'address,home_set,latest_roof,latest_ac,expired_permits\n' +
  [...homes].sort().map(([a, h]) => [a, h.set, h.roof, h.ac, h.open.join('; ')].map(csvq).join(',')).join('\n') + '\n');
fs.writeFileSync(DIR + '/last_run.txt', `${today}\n${all.size} permits total, ${isFirstRun ? 'first run' : fresh.length + ' new'}\n` + log.join('\n') + '\n');
