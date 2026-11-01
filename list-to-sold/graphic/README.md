# Locked flyer design (approved 11/01/2026) — DO NOT REDESIGN

`LOCKED_REFERENCE.jpg` is the approved flyer. Every monthly update must look exactly like it.
`report_template.html` is the code that produces it (Version F).

## Every update
- Change ONLY the numbers, the bar heights (scale to the % values) and the "UPDATED" date.
- Keep the same boxes, same order, same labels, colors, fonts, sizes and footer.
- Do not add, remove, rename or reword anything. No new stats, notes, disclaimers, prices or fees.
- If a number can't be verified from master_sales.csv / sun_exits_2026.csv, stop and ask Shane. Never estimate.
- Show Shane the finished flyer next to LOCKED_REFERENCE.jpg and list which numbers changed. Nothing is final until he approves.

## Render
Fonts: `npm i @fontsource/orbitron @fontsource/rajdhani` next to the template.
Render with Playwright/Chrome at 1000px wide, 2x scale (1500x2403 JPG to match the reference).
