// Water Oak permit robot — Lake County Building Services permit search by address,
// plus Lake County Property Appraiser (year built / city) for each address.
// Reads permits/addresses.txt, writes permits/permits.json and debug pages.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

execSync('npm i --no-save --no-audit --no-fund playwright', { stdio: 'inherit' });
execSync('npx playwright install --with-deps chromium', { stdio: 'inherit' });
const { chromium } = await import('playwright');

const DIR = 'permits';
const DBG = DIR + '/debug';
fs.mkdirSync(DBG, { recursive: true });
const SEARCH = 'https://c.lakecountyfl.gov/offices/building_services/permit_activity_reports/permit_search_by_address.aspx';
const today = new Date().toISOString().slice(0, 10);

const addrs = fs.readFileSync(DIR + '/addresses.txt', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 900 }, locale: 'en-US'
});
const page = await ctx.newPage();
const slug = s => s.replace(/[^a-z0-9]+/gi, '_');

async function tables() {
  return page.$$eval('table', ts => ts.map(t => [...t.rows].map(r => [...r.cells].map(c => c.innerText.trim()))));
}

const out = { updated: today, results: [] };

for (const a of addrs) {
  // "916|Norman"  -> number | street name (no street type)
  const [num, street] = a.split('|').map(s => s.trim());
  const rec = { address: `${num} ${street}`, permits: [], error: null };
  try {
    await page.goto(SEARCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const inputs = await page.$$('input[type=text], input:not([type])');
    fs.writeFileSync(`${DBG}/form.html`, await page.content());
    if (inputs.length < 2) throw new Error('form inputs not found: ' + inputs.length);
    await inputs[0].fill(num);
    await inputs[1].fill(street);
    const btn = await page.$('input[type=submit], button[type=submit], input[type=button]');
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), btn ? btn.click() : inputs[1].press('Enter')]);
    await page.waitForTimeout(4000);
    fs.writeFileSync(`${DBG}/${slug(rec.address)}.html`, await page.content());
    fs.writeFileSync(`${DBG}/${slug(rec.address)}.txt`, await page.innerText('body'));
    rec.tables = (await tables()).filter(t => t.length > 1 && t.flat().join(' ').match(/\d{2}\/\d{2}\/\d{4}|permit/i));
    // follow permit detail links if any
    const links = await page.$$eval('a', as => as.map(x => ({ t: x.innerText.trim(), h: x.href })).filter(x => /permit/i.test(x.h) && /\d/.test(x.t)));
    for (const l of links.slice(0, 25)) {
      try {
        const p2 = await ctx.newPage();
        await p2.goto(l.h, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p2.waitForTimeout(1500);
        rec.permits.push({ id: l.t, url: l.h, text: (await p2.innerText('body')).replace(/\s+\n/g, '\n').slice(0, 4000) });
        await p2.close();
      } catch (e) { rec.permits.push({ id: l.t, url: l.h, error: String(e).slice(0, 200) }); }
    }
  } catch (e) { rec.error = String(e).slice(0, 300); }
  out.results.push(rec);
  console.log(rec.address, rec.error || `${(rec.tables || []).length} tables, ${rec.permits.length} details`);
}

/* ---------- Lake County Property Appraiser (year built, roof, size) ---------- */
out.pa = [];
const paList = (fs.existsSync(DIR + '/pa_addresses.txt') ? fs.readFileSync(DIR + '/pa_addresses.txt', 'utf8') : '').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
for (const full of paList) {
  const rec = { address: full, error: null, steps: [] };
  try {
    await page.goto('https://www.lakecopropappr.com/', { waitUntil: 'networkidle', timeout: 90000 });
    rec.steps.push(page.url());
    const lk = await page.$('a:has-text("Property Search"), a:has-text("Search Records"), a:has-text("Real Estate Search")');
    if (lk) { await lk.click(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(3000); }
    rec.steps.push(page.url());
    fs.writeFileSync(`${DBG}/pa_search.html`, await page.content());
    const ins = await page.$$('input[type=text]:visible, input[type=search]:visible, input:not([type]):visible');
    const meta = [];
    for (const f of ins) meta.push([await f.getAttribute('name'), await f.getAttribute('id'), await f.getAttribute('placeholder')].join('|'));
    rec.fields = meta;
    const [num, ...rest] = full.split(' ');
    const iNum = meta.findIndex(m => /house|stre?e?tn(um|o)|addrnum|number/i.test(m));
    const iSt = meta.findIndex(m => /streetname|stname|street(?!num)/i.test(m));
    const iAd = meta.findIndex(m => /address|situs|location/i.test(m));
    let target;
    if (iNum >= 0 && iSt >= 0) { await ins[iNum].fill(num); await ins[iSt].fill(rest[0] === 'E' || rest[0] === 'W' ? rest[1] : rest[0]); target = ins[iSt]; }
    else if (iAd >= 0) { await ins[iAd].fill(full); target = ins[iAd]; }
    else throw new Error('no PA address field');
    const btn = await page.$('input[type=submit]:visible, button[type=submit]:visible, input[value*="Search" i]:visible, button:has-text("Search"):visible');
    await (btn ? btn.click() : target.press('Enter'));
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(4000);
    fs.writeFileSync(`${DBG}/pa_${slug(full)}_results.html`, await page.content());
    rec.resultsText = (await page.innerText('body')).slice(0, 4000);
    const hit = await page.$(`a:has-text("${num}")`);
    if (hit) {
      const [np] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), hit.click()]);
      const pg = np || page;
      await pg.waitForLoadState('networkidle').catch(() => {});
      await pg.waitForTimeout(4000);
      rec.detailUrl = pg.url();
      rec.detailText = (await pg.innerText('body')).slice(0, 12000);
      fs.writeFileSync(`${DBG}/pa_${slug(full)}.txt`, rec.detailText);
    }
  } catch (e) { rec.error = String(e).slice(0, 300); }
  out.pa.push(rec);
  console.log('PA', full, rec.error || 'ok');
}

await browser.close();
fs.writeFileSync(DIR + '/permits.json', JSON.stringify(out, null, 2));
