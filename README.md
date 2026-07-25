# WA Suite

One Next.js app, one Vercel deployment, one Supabase project:

- **Campaign Manager** — `public/campaign/index.html` (create), `campaigns.html` (browse), `clicks.html` ("Clicker Data" — click reporting)
- **Link shortener + click tracking** — the engine behind Clicker Data (`/api/create`, `/[code]` redirect + logger)

## What's in this version

### 1. Clicker Data (moved out of "New Campaign")
`public/campaign/clicks.html` is now its own page (sidebar: **Clicks**), separate
from the campaign creation form. It shows:
- **Summary table**, one row per campaign button name: links sent, total
  clicks, unique recipients clicked (by mobile number), last click
- **Click a row to expand** into the individual recipients/links for that
  campaign button
- **"Show Details"** per recipient opens a modal with the raw click log
  (when, IP, location, referrer, device), paginated
- **Download CSV** (streams the complete matching dataset, no size limit)
  and **Download Excel** (capped at 50,000 rows, appends a warning row if
  truncated — use CSV for anything larger)

### 2, 3, 4. New campaign fields
Three new fields, all on the `campaigns` table, all mandatory where they apply,
all included in every API response that returns a campaign:

| Field | Where it appears | Required when |
|---|---|---|
| `l1_cta_name` | Level 1 panel, next to the CTA URL | Level 1 button type = Call to Action |
| `l12_button_bridge_name` | Level 2 panel, right after the creative upload | Level 1 button type = Quick Reply |
| `l2_cta_name` | Level 2 panel, next to the Level 2 CTA URL | Level 1 button type = Quick Reply |

`l1_cta_name` / `l2_cta_name` are the text shown on the CTA buttons themselves
(e.g. "Shop Now"). `l12_button_bridge_name` is the label on the Level 1 Quick
Reply button that bridges into the Level 2 message — placed in the Level 2
panel per your instruction, even though it's conceptually the Level 1 button's
label.

**Alter commands** (also in `MIGRATION.sql`):
```sql
alter table campaigns add column if not exists l1_cta_name text;
alter table campaigns add column if not exists l2_cta_name text;
alter table campaigns add column if not exists l12_button_bridge_name text;
```

### 5. Built for scale (1M+ interactions)
The old approach (fetch all links + all clicks into Node, group in JS) does
not scale. This version does all aggregation and pagination **inside
Postgres**, via three RPC functions defined in `supabase-schema.sql` /
`MIGRATION.sql`:

- `get_click_summary(...)` — grouped totals per campaign button name
- `get_links_report(...)` — paginated link/recipient rows with per-row click
  counts computed via a `LATERAL` join (only for the rows on the current page)
- `get_link_clicks(...)` — paginated raw click log for one link

The API routes (`/api/click-summary`, `/api/links`, `/api/link-clicks`) are
thin wrappers that call these. None of them ever pull the whole table into
memory. CSV export streams in batches of 1,000 rows directly to the response,
so it stays fast and memory-flat at any dataset size. Indexes are included on
every column these functions filter or join on.

### 6. Single Supabase project
Both the campaign table and the link/click tables live in **one** Supabase
project now, using **one** set of env vars: `SUPABASE_URL` /
`SUPABASE_SERVICE_KEY`. `lib/supabaseClient.js` is the single client used by
every API route — the earlier `LINKS_SUPABASE_*` / dual-client split has been
removed entirely.

## Environment variables

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | the project's `service_role` secret key |
| `NEXT_PUBLIC_BASE_URL` | optional — your production domain, used to build `short_url`. Falls back to the request host if blank |
| `ONEXAURA_API_KEY` | Onexaura media upload |
| `ONEXAURA_PHONE_NUMBER` | Onexaura media upload, e.g. `919217090193` |

See `.env.example`.

## Database setup

**Fresh project:** run `supabase-schema.sql` in the Supabase SQL Editor.

**Already-live database:** run `MIGRATION.sql` instead — it's ALTER/CREATE OR
REPLACE-only and safe to re-run.

## Project structure

```
app/
  page.js                    landing page
  dashboard/page.js          redirects to /campaign/clicks.html (legacy URL support only)
  [code]/route.js            short-link redirect + click logger
  api/
    create/route.js              POST -> create a short link
    links/route.js               GET  -> paginated link/recipient report (RPC-backed)
    click-summary/route.js       GET  -> grouped summary by campaign button (RPC-backed)
    link-clicks/route.js         GET  -> paginated raw click log for one link (RPC-backed)
    export/links/route.js        GET  -> CSV (streamed, unbounded) / Excel (capped 50k) export
    create-campaign/route.js     POST -> create a campaign
    list-campaigns/route.js      GET  -> paginated campaign list
    campaign-details/route.js    GET  -> full JSON for one campaign
    upload-media/route.js        POST -> proxies file to Onexaura
public/campaign/
  index.html + create.js         New Campaign
  campaigns.html + campaigns.js  All Campaigns
  clicks.html + clicks.js        Clicker Data (NEW page)
  styles.css                     shared theme
lib/
  supabaseClient.js           the one Supabase client, used everywhere
supabase-schema.sql            full schema (fresh install)
MIGRATION.sql                  ALTER-only migration (already-live database)
```

## Local development

```bash
npm install
cp .env.example .env.local
# fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, ONEXAURA_API_KEY, ONEXAURA_PHONE_NUMBER
npm run dev
```

- New Campaign: http://localhost:3000/campaign/index.html
- All Campaigns: http://localhost:3000/campaign/campaigns.html
- Clicker Data: http://localhost:3000/campaign/clicks.html

## Deploy to Vercel

Push to your connected repo. Set the 5 env vars above in Vercel → Project →
Settings → Environment Variables, then redeploy. Run `MIGRATION.sql` in
Supabase before or right after deploying — the new campaign fields are
mandatory in the UI, so campaigns created after deploy will fail to save
without the new columns existing.

## Final cURLs

**Create a short link:**
```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/create \
  -H "Content-Type: application/json" \
  -d '{
    "long_url": "https://example.com/offer",
    "mobile_number": "+919876543210",
    "campaign_button_name": "L1_campaign_CTA_20260724_103000",
    "label": "test link"
  }'
```

**Create a campaign (CTA flow):**
```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/create-campaign \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_name": "monsoon_offer_gaming",
    "flow_type": "CTA",
    "l1_media_url": "https://media.onexaura.example/abc123.jpg",
    "l1_message_body": "Big monsoon offer just for you!",
    "l1_cta_url": "https://example.com/offer",
    "l1_cta_name": "Shop Now"
  }'
```

**Create a campaign (Quick Reply flow):**
```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/create-campaign \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_name": "monsoon_offer_gaming",
    "flow_type": "QR",
    "l1_media_url": "https://media.onexaura.example/abc123.jpg",
    "l1_message_body": "Big monsoon offer just for you!",
    "l2_media_url": "https://media.onexaura.example/def456.jpg",
    "l12_button_bridge_name": "Yes, tell me more",
    "l2_message_body": "Here is your discount code!",
    "l2_cta_name": "Shop Now",
    "l2_cta_url": "https://example.com/offer"
  }'
```

**List campaigns:**
```bash
curl "https://YOUR-DOMAIN.vercel.app/api/list-campaigns?page=1&pageSize=10"
```

**Campaign details:**
```bash
curl "https://YOUR-DOMAIN.vercel.app/api/campaign-details?button_name=L1_campaign_CTA_20260724_103000"
```

**Click summary (grouped by campaign button):**
```bash
curl "https://YOUR-DOMAIN.vercel.app/api/click-summary?campaign_button_name=L1_campaign_CTA_20260724_103000"
```

**Paginated link/recipient report:**
```bash
curl "https://YOUR-DOMAIN.vercel.app/api/links?campaign_button_name=L1_campaign_CTA_20260724_103000&exact=true&page=1&pageSize=25"
```

**Raw click log for one link:**
```bash
curl "https://YOUR-DOMAIN.vercel.app/api/link-clicks?code=aB3xQ9k&page=1&pageSize=50"
```

**Export (browser download links, or curl -O):**
```bash
curl -O -J "https://YOUR-DOMAIN.vercel.app/api/export/links?format=csv"
curl -O -J "https://YOUR-DOMAIN.vercel.app/api/export/links?format=xlsx&campaign_button_name=L1_campaign_CTA_20260724_103000"
```

**Upload media:**
```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/upload-media \
  -F "file=@/path/to/creative.jpg"
```

## Things worth knowing

- **"Unique" in the summary** = distinct mobile numbers a link was created
  for (recipient-level), not distinct IPs. The recipient-level drill-down
  table still shows per-link "Unique" by IP for reference.
- **Vercel serverless body limit**: ~4.5 MB on Hobby. The 5 MB upload UI
  limit can occasionally exceed this on Hobby — unrelated to this update.
- **Auth**: nothing is behind a login yet. Say the word if you want it.
- **Excel export cap**: 50,000 rows by design (per your instruction) — a
  warning row is appended if the export was truncated. CSV has no cap.
