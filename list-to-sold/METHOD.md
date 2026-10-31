# Water Oak List-to-Sold — Locked Method

Water Oak Country Club Estates (Lady Lake, FL) only. Do not invent a new method, switch sources, or "improve" it.
First built and verified 2026-10-31 (52 paired Jan 1–Oct 31, 2026 sales).

## Files (this folder)
| File | What it is | Rule |
|---|---|---|
| `master_sales.csv` | Every paired sale ever verified | Append/correct only. Never drop a row. |
| `gaps.csv` | Every sale or stamp that is NOT paired, with reason | Move a row to master only when it gets verified. |
| `foxfire_sold_seen.csv` | Every Foxfire SOLD card ever seen (id, address, Foxfire price, list date, maker, serial, rent, garage) | Append new ids each run. |
| `build_report.py` | Builds the report from the two CSVs | `python3 build_report.py YEAR END_DATE OUT.xlsx` |

## Sources (in this order)
1. **RE/MAX Foxfire sold archive** — `foxfiremanufactured.com/properties.html` (redirects to ViewAllFeaturedCustom.asp). Cards marked SOLD in Lady Lake. Open each `HomedetailCustom.asp?id=N`; keep only pages whose Community says Water Oak. This is the **address list**.
2. **Highrises.com (Realtor.com data, MyStateMLS history)** — the **sold price, sold date and list history**.
   - Water Oak sold list: `highrises.com/realestateandhomes-search/Water-Oaks-Country-Club-Estates_Lady-Lake_FL/show-recently-sold` (data in `__NEXT_DATA__`; only ~6 months back and it MISSES homes — never rely on it alone).
   - Each address: search box on highrises.com → detail page `/realestateandhomes-detail/M##########` → "Price history" (click "Property history" on active/pending listings).
3. MHVillage, Sun: not used for pairing (MHVillage "Last Reported Price" = asking price; Sun in-house sales have no public price).
- Blocked/unusable (don't retry): realtor.com (blocked in app browser), mystatemls.com (Cloudflare human check), homefinder (no sold pages), Redfin (no Water Oak leased-land homes), MHVillage API/sold crawling (robots.txt disallows).
- Everything runs in the **Claude desktop app's browser on Shane's computer** (mcp Claude_Browser tools). Cloud fetches are blocked.

## Pairing rules
- **Paired** = list price + sold price + sold date, sold date inside the report year.
- List price used:
  - MyStateMLS history present → last list price before the sale; original = first "Listed" of that run (remove/relist inside the run = same run). Source = `MyStateMLS`.
  - No MLS listing event, but Foxfire price ≠ MLS sold price → Foxfire price + Foxfire "Available" date. Source = `Foxfire` (labeled "not confirmed as last").
  - Foxfire price = MLS sold price and no MLS listing event → **gap** (`no_verified_list`). Foxfire sometimes shows the sold price (e.g. 529 Spruce $14,000).
- DOM = sold date − list date of the run that sold.
- % = (sold − list used) / list used. Never compare list medians to sold medians.

## Cleaning rules
- Pending / under contract → out (gaps `pending`).
- Foxfire SOLD stamp with no MLS sale → gaps `stamp_no_sale`.
- Sold figure that contradicts the listing (e.g. equals an old sale price) → gaps `source_conflict`.
- Sold before the report year → gaps `sold_2025` (category name kept for any prior year).
- Rentals never counted. Same house number on different streets (908 Travino vs 908 Lietzke) stays separate unless a source links them.
- Homes that sold twice in a year: each sale is its own row (818 Sutton, 605 Nicklaus).
- No guessing makers: Foxfire maker codes as printed.

## Each run (update)
1. Read the CSVs. Note the latest `sold_date` in master.
2. Highrises Water Oak sold list → any sale newer than that, or any address not in master/gaps → open its history, apply rules, add to master or gaps.
3. Foxfire archive → any SOLD id not in `foxfire_sold_seen.csv` → add it, then look the address up on Highrises.
4. Re-check every `pending` and `stamp_no_sale` row.
5. Spot-check 3 existing master rows against Highrises; fix anything that changed.
6. `python3 build_report.py YEAR END_DATE`, recalc, verify counts/medians against the CSV, deliver the .xlsx.
7. Commit the CSVs (message: "List-to-sold update YYYY-MM-DD: +N sales").
