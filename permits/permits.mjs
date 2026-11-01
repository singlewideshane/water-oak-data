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

/* ---------- Town of Lady Lake (Citizenserve, installation 383) ---------- */
const CS = 'https://www6.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=383&original_iid=0&original_contactID=0';
out.town = [];
async function dumpInputs(p) {
  return p.$$eval('input,select,button,a', es => es.map(e => ({
    tag: e.tagName, type: e.type || '', name: e.name || '', id: e.id || '', val: (e.value || '').slice(0, 40),
    text: (e.innerText || '').trim().slice(0, 60), opts: e.tagName === 'SELECT' ? [...e.options].map(o => o.value + '=' + o.text).slice(0, 30) : undefined
  })).filter(x => x.tag !== 'A' || /search|permit/i.test(x.text)));
}
try {
  await page.goto(CS, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);
  fs.writeFileSync(`${DBG}/town_search.html`, await page.content());
  fs.writeFileSync(`${DBG}/town_inputs.json`, JSON.stringify(await dumpInputs(page), null, 1));
  // pick "Permit" in any search-type dropdown
  for (const s of await page.$$('select')) {
    const opts = await s.$$eval('option', os => os.map(o => ({ v: o.value, t: o.text })));
    const o = opts.find(x => /^permits?$/i.test(x.t.trim())) || opts.find(x => /permit/i.test(x.t));
    if (o) { await s.selectOption(o.v); await page.waitForTimeout(2500); }
  }
  fs.writeFileSync(`${DBG}/town_inputs2.json`, JSON.stringify(await dumpInputs(page), null, 1));
  for (const a of addrs) {
    const [num, street] = a.split('|').map(s => s.trim());
    const rec = { address: `${num} ${street}`, error: null };
    try {
      await page.goto(CS, { waitUntil: 'networkidle', timeout: 90000 });
      for (const s of await page.$$('select')) {
        const opts = await s.$$eval('option', os => os.map(o => ({ v: o.value, t: o.text })));
        const o = opts.find(x => /^permits?$/i.test(x.t.trim())) || opts.find(x => /permit/i.test(x.t));
        if (o) { await s.selectOption(o.v); await page.waitForTimeout(2500); }
      }
      const fields = await page.$$('input[type=text]:visible');
      const meta = [];
      for (const f of fields) meta.push(((await f.getAttribute('name')) || '') + '|' + ((await f.getAttribute('id')) || ''));
      rec.fields = meta;
      const byName = re => fields[meta.findIndex(m => re.test(m))];
      const fNum = byName(/streetnum|stnum|housenum|number/i);
      const fSt = byName(/streetname|stname|street/i);
      const fAddr = byName(/address/i);
      if (fNum && fSt) { await fNum.fill(num); await fSt.fill(street); }
      else if (fAddr) await fAddr.fill(`${num} ${street}`);
      else throw new Error('no address field');
      const btn = await page.$('input[type=submit]:visible, button:has-text("Search"), input[value*="Search" i]:visible, a:has-text("Search"):visible');
      await (btn ? btn.click() : (fSt || fAddr).press('Enter'));
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(4000);
      fs.writeFileSync(`${DBG}/town_${slug(rec.address)}.html`, await page.content());
      rec.text = (await page.innerText('body')).slice(0, 6000);
      rec.tables = (await tables()).filter(t => t.length > 1);
      // open each result row link for detail
      const links = await page.$$eval('a', as => as.map(x => ({ t: x.innerText.trim(), h: x.href, oc: x.getAttribute('onclick') || '' })).filter(x => /^[A-Z]{0,4}-?\d{2,}/.test(x.t)));
      rec.details = [];
      for (const l of links.slice(0, 30)) {
        try {
          const p2 = await ctx.newPage();
          if (l.h && !l.h.startsWith('javascript')) await p2.goto(l.h, { waitUntil: 'networkidle', timeout: 60000 });
          else { await p2.close(); continue; }
          await p2.waitForTimeout(1500);
          rec.details.push({ id: l.t, text: (await p2.innerText('body')).slice(0, 4000) });
          await p2.close();
        } catch (e) { rec.details.push({ id: l.t, error: String(e).slice(0, 200) }); }
      }
      // if links are javascript, click each in place and capture
      if (!rec.details.length) {
        const jl = await page.$$('a');
        let k = 0;
        for (const el of jl) {
          const t = ((await el.innerText()) || '').trim();
          if (!/^[A-Z]{0,4}-?\d{2,}/.test(t) || k >= 30) continue;
          k++;
          try {
            await el.click();
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(2500);
            rec.details.push({ id: t, text: (await page.innerText('body')).slice(0, 4000) });
            await page.goBack({ waitUntil: 'networkidle' }).catch(() => {});
            await page.waitForTimeout(2000);
          } catch (e) { rec.details.push({ id: t, error: String(e).slice(0, 200) }); break; }
        }
      }
    } catch (e) { rec.error = String(e).slice(0, 300); }
    out.town.push(rec);
    console.log('TOWN', rec.address, rec.error || `${(rec.tables || []).length} tables, ${rec.details.length} details`);
  }
} catch (e) { out.townError = String(e).slice(0, 300); console.log('TOWN ERR', e); }

await browser.close();
fs.writeFileSync(DIR + '/permits.json', JSON.stringify(out, null, 2));
