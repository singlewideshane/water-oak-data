LISTINGS TRACKER — put it on your phone
=======================================

STEP 1 — UPDATE THE SITE YOU ALREADY HAVE
  1. Unzip this folder.
  2. Go to app.netlify.com and log in.
  3. Open your existing project: lambent-bublanina-a695d4
  4. Go to its Deploys tab and drag this whole unzipped folder
     onto the Production deploys drop area on THAT page.

  Do NOT use app.netlify.com/drop and do NOT use "Add new site".
  Either one makes a brand new site with a brand new address,
  and your home screen icon keeps pointing at the old one.

  Your saved listings are untouched by an update — they live on
  the phone, not in the deploy.

STEP 2 — PUT IT ON YOUR HOME SCREEN (one time, 30 seconds, on your iPhone)
  1. Open that address in SAFARI. It has to be Safari, not Chrome.
  2. Tap the Share button (the square with the arrow going up).
  3. Scroll down and tap "Add to Home Screen".
  4. Tap Add.

Done. You now have an icon called "Listings" on your phone.
One tap, opens full screen, no browser bar, no Claude.

DAILY USE
  Tap the icon. Tap a listing. Tap + when you take a call or
  hold a showing. That's it. It saves itself.

THE MARKET TAB
  There are now two tabs at the top. "My listings" is what you
  already had, unchanged. "Market" is for tracking everybody
  else's homes in Water Oak.

  Set it up once: tap "Add a home to track" and put in the homes
  you see for sale on Sun, Foxfire and MHVillage. Address and
  asking price is enough. You do not need all of them on day
  one — add more as you go.

  Then every Monday at 7pm: open Sun, Foxfire and MHVillage,
  tap "Log this week's check", type the three totals, and tap
  any home you can no longer find. Two minutes.

  What it works out for you:
    - the price band homes are LEAVING at (what is moving)
    - the price band homes are SITTING at (what is not)
    - how many months of inventory the community is holding
    - how long homes take to go

  A home vanishing usually means it sold, but sometimes the
  seller just pulled it. If you learn that happened, open the
  home and tap "It was withdrawn, not sold" so it stays out of
  the numbers.

  Give it five or six off-market homes before you trust the
  band. The app will tell you when the sample is still thin.

  The months-of-inventory figure stays hidden until you have at
  least three homes gone and about six weeks of tracking. That
  is on purpose — before that it swings wildly and would tell
  you something confident and wrong.

THE VIEWS TAB
  There are now three tabs. "Views" is where you log the daily
  Zillow views and saves from your daily Zillow email — one
  listing at a time or all at once.

  Every day: tap the icon, go to Views, tap "Log yesterday's
  numbers." The date starts on yesterday, to match Zillow's
  next-day email. Type in the views and saves for each listing
  and tap Save. Takes under a minute for all of them.

  Tap a listing on the Views tab to see its day-by-day history,
  totals, and a 7-day average. Tap any day in that history to
  fix a typo or delete it.

  Once a listing has 10 days logged, the app also tells you
  which day of the week tends to get the most views — useful
  for timing a new post or a price drop.

LOGGING A CHANGE
  When you change a listing's description, photos, or add an
  incentive, open it on the Views tab and tap "Log a change."
  Tap what changed, add a short note, Save. Price changes show
  up on their own.

  Each change gets a card comparing views per day and save rate
  for the week before vs. the week after. Give it 7 days before
  trusting it.

BACKING UP
  Your data lives on your phone, not on the internet. Nobody
  else can see it. But that also means if you erase Safari's
  website data or get a new phone, it's gone.

  Once a month: open the app, scroll to the bottom, tap
  "Back up my data", and email it to yourself. To bring it
  back, tap "Restore from a backup" and paste it in.

CHANGING THE APP LATER
  If you want new fields or changes, the whole app is the one
  file index.html. Get a new version, drag the folder onto the
  same Netlify site again, and your home screen icon keeps
  working. Your saved data is untouched by updates.

FACT SHEET (added Oct 8, 2026)
  Open a listing and tap "Fact sheet and buyer questions."
  Tap any fact to edit it and mark it Confirmed, Needs
  confirmation, or Unknown. Only Confirmed facts go into the
  copy buttons. Internal notes are never copied. Nothing is
  sent or posted. You review the text and paste it yourself.

UPDATES FROM CLAUDE (added Oct 16, 2026)
  Tell Claude the numbers, e.g. "Bob's house: 41 views, 2 saves,
  3 showings today." Claude saves them to your GitHub repo
  (water-oak-data, file data/log.json). Next time you open the
  app it fills them in and shows a green "Updated from Claude"
  note. Each update is applied once. Showings and calls are the
  total for that day, so nothing gets double-counted if you also
  tapped + yourself.

LET CLAUDE READ YOUR NUMBERS (added Oct 16, 2026, version 4)
  On My listings, scroll to the bottom and tap "Let Claude read my
  numbers", then paste your GitHub token. After that, every change
  you make is sent to water-oak-data/data/stats.json, so you can ask
  Claude about any listing. Only stats go out: address, status,
  prices, daily views/saves, calls, showings, and changes. Client
  names, phone numbers, notes and fact sheets stay on the phone.
  Claude can now also log changes ("posted to a Facebook group",
  "new photos") and price drops for you.
