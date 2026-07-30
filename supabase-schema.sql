-- ============================================================================
-- FULL SCHEMA — run this once on a fresh Supabase project (SQL Editor).
-- If your tables already exist, skip to MIGRATION.sql instead (ALTER-only).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Link shortener + click tracking
-- ---------------------------------------------------------------------------
create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  long_url text not null,
  mobile_number text,
  label text,
  campaign_button_name text,
  created_at timestamptz not null default now()
);

create table if not exists clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references links(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  ip text,
  user_agent text,
  referrer text,
  country text,
  city text
);

create index if not exists idx_links_code on links(code);
create index if not exists idx_links_mobile on links(mobile_number);
create index if not exists idx_links_campaign_button_name on links(campaign_button_name);
create index if not exists idx_links_created_at on links(created_at desc);
create index if not exists idx_clicks_link_id on clicks(link_id);
create index if not exists idx_clicks_link_id_clicked_at on clicks(link_id, clicked_at desc);

-- ---------------------------------------------------------------------------
-- Campaign manager
-- ---------------------------------------------------------------------------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  button_name text unique not null,
  flow_type text not null check (flow_type in ('CTA', 'QR')),
  l1_media_url text not null,
  l1_message_body text not null,
  l1_cta_url text,
  l1_cta_name text,            -- label shown on the level-1 CTA button (mandatory when flow_type = CTA)
  l2_media_url text,
  l2_message_body text,
  l2_cta_url text,
  l2_cta_name text,            -- label shown on the level-2 CTA button (mandatory when flow_type = QR)
  l12_button_bridge_name text, -- label shown on the level-1 Quick Reply button that bridges to level 2 (mandatory when flow_type = QR)
  created_at timestamptz not null default now()
);

create index if not exists idx_campaigns_campaign_name on campaigns(campaign_name);
create index if not exists idx_campaigns_button_name on campaigns(button_name);
create index if not exists idx_campaigns_created_at on campaigns(created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security: kept ON everywhere. The app only ever talks to
-- Supabase using the SERVICE ROLE key (server-side only), so no policies
-- are needed for the app to work — this just blocks anon/public key access.
-- ---------------------------------------------------------------------------
alter table links enable row level security;
alter table clicks enable row level security;
alter table campaigns enable row level security;

-- ============================================================================
-- REPORTING FUNCTIONS (RPC)
--
-- These do the aggregation/pagination INSIDE Postgres instead of pulling
-- rows into the Node app and grouping in JS. That's the difference between
-- "works at 100 rows" and "works at 1,000,000 rows": with these, the API
-- only ever transfers the page of rows actually being displayed (or, for
-- CSV export, streams in fixed-size batches) — never the whole table.
-- ============================================================================

-- Summary: one row per campaign_button_name, with click/recipient totals.
-- "Unique" = distinct mobile numbers that were sent a link (recipient-level,
-- per your instruction), not distinct IPs. Ordered newest-activity-first.
-- p_start_date/p_end_date optionally scope which CLICKS count toward
-- total_clicks/last_click (via the JOIN condition, not a WHERE clause) --
-- total_links/unique_mobiles are unaffected by the date range.
create or replace function get_click_summary(
  p_mobile text default null,
  p_campaign_button_name text default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  campaign_button_name text,
  total_links bigint,
  total_clicks bigint,
  unique_mobiles bigint,
  last_click timestamptz
)
language sql
stable
as $$
  select
    coalesce(l.campaign_button_name, '(no campaign button)') as campaign_button_name,
    count(distinct l.id)                                      as total_links,
    count(c.id)                                                as total_clicks,
    count(distinct l.mobile_number)                            as unique_mobiles,
    max(c.clicked_at)                                          as last_click
  from links l
  left join clicks c
    on c.link_id = l.id
    and (p_start_date is null or c.clicked_at >= p_start_date)
    and (p_end_date is null or c.clicked_at <= p_end_date)
  where (p_mobile is null or l.mobile_number ilike '%' || p_mobile || '%')
    and (p_campaign_button_name is null or l.campaign_button_name ilike '%' || p_campaign_button_name || '%')
  group by coalesce(l.campaign_button_name, '(no campaign button)')
  order by max(c.clicked_at) desc nulls last, count(c.id) desc;
$$;

-- Paginated link-level report (one row per short link / recipient), with
-- click counts computed per-row via a LATERAL join — so Postgres only
-- aggregates clicks for the rows actually being returned on this page,
-- not the entire clicks table. p_start_date/p_end_date optionally scope
-- the click stats the same way as get_click_summary above.
create or replace function get_links_report(
  p_mobile text default null,
  p_campaign_button_name text default null,
  p_exact boolean default false,
  p_page int default 1,
  p_page_size int default 25,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  id uuid,
  code text,
  long_url text,
  mobile_number text,
  campaign_button_name text,
  label text,
  created_at timestamptz,
  total_clicks bigint,
  unique_clicks bigint,
  last_clicked_at timestamptz,
  total_count bigint
)
language sql
stable
as $$
  with filtered as (
    select l.*
    from links l
    where (p_mobile is null or l.mobile_number ilike '%' || p_mobile || '%')
      and (
        p_campaign_button_name is null
        or (p_exact and l.campaign_button_name = p_campaign_button_name)
        or (not p_exact and l.campaign_button_name ilike '%' || p_campaign_button_name || '%')
      )
  ),
  counted as (
    select count(*) as total_count from filtered
  )
  select
    f.id, f.code, f.long_url, f.mobile_number, f.campaign_button_name, f.label, f.created_at,
    coalesce(cs.total_clicks, 0) as total_clicks,
    coalesce(cs.unique_clicks, 0) as unique_clicks,
    cs.last_clicked_at,
    (select total_count from counted) as total_count
  from filtered f
  left join lateral (
    select
      count(*)              as total_clicks,
      count(distinct c.ip)  as unique_clicks,
      max(c.clicked_at)     as last_clicked_at
    from clicks c
    where c.link_id = f.id
      and (p_start_date is null or c.clicked_at >= p_start_date)
      and (p_end_date is null or c.clicked_at <= p_end_date)
  ) cs on true
  order by f.created_at desc
  limit p_page_size offset (p_page - 1) * p_page_size;
$$;

-- Paginated individual click log for ONE link (used by the "Show Clicks"
-- detail modal) — never pulls more than one page of clicks at a time.
create or replace function get_link_clicks(
  p_code text,
  p_page int default 1,
  p_page_size int default 50
)
returns table (
  id uuid,
  clicked_at timestamptz,
  ip text,
  city text,
  country text,
  referrer text,
  user_agent text,
  total_count bigint
)
language sql
stable
as $$
  with target as (
    select id from links where code = p_code
  ),
  counted as (
    select count(*) as total_count from clicks where link_id = (select id from target)
  )
  select c.id, c.clicked_at, c.ip, c.city, c.country, c.referrer, c.user_agent,
    (select total_count from counted)
  from clicks c
  where c.link_id = (select id from target)
  order by c.clicked_at desc
  limit p_page_size offset (p_page - 1) * p_page_size;
$$;

-- Returns one row per CLICK (not per link) for a single exact
-- campaign_button_name, with the link's own stats repeated on every row --
-- used by the row-level "Download" button on the Clicker Data summary table.
-- Links with zero clicks still appear once, with the click columns blank.
create or replace function get_campaign_click_detail(
  p_campaign_button_name text,
  p_page int default 1,
  p_page_size int default 1000,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
)
returns table (
  mobile_number text,
  code text,
  long_url text,
  total_clicks bigint,
  unique_clicks bigint,
  last_clicked_at timestamptz,
  created_at timestamptz,
  clicked_at timestamptz,
  ip text,
  city text,
  country text,
  user_agent text,
  total_count bigint
)
language sql
stable
as $$
  with target_links as (
    select l.*
    from links l
    where l.campaign_button_name = p_campaign_button_name
  ),
  link_stats as (
    select
      tl.id,
      count(c.id)             as total_clicks,
      count(distinct c.ip)    as unique_clicks,
      max(c.clicked_at)       as last_clicked_at
    from target_links tl
    left join clicks c
      on c.link_id = tl.id
      and (p_start_date is null or c.clicked_at >= p_start_date)
      and (p_end_date is null or c.clicked_at <= p_end_date)
    group by tl.id
  ),
  joined as (
    select
      tl.mobile_number,
      tl.code,
      tl.long_url,
      ls.total_clicks,
      ls.unique_clicks,
      ls.last_clicked_at,
      tl.created_at,
      c.clicked_at,
      c.ip,
      c.city,
      c.country,
      c.user_agent
    from target_links tl
    join link_stats ls on ls.id = tl.id
    left join clicks c
      on c.link_id = tl.id
      and (p_start_date is null or c.clicked_at >= p_start_date)
      and (p_end_date is null or c.clicked_at <= p_end_date)
  ),
  counted as (
    select count(*) as total_count from joined
  )
  select j.*, (select total_count from counted)
  from joined j
  order by j.created_at desc, j.clicked_at desc nulls last
  limit p_page_size offset (p_page - 1) * p_page_size;
$$;

-- ---------------------------------------------------------------------------
-- Login module
-- ---------------------------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_email on users(email);

-- Verifies a login attempt entirely inside Postgres via pgcrypto's crypt() --
-- the plaintext password is never compared in application code.
create or replace function verify_user_login(p_email text, p_password text)
returns table (id uuid, email text)
language sql
stable
as $$
  select id, email
  from users
  where email = p_email
    and password_hash = crypt(p_password, password_hash);
$$;

-- Create your first login (run once, with your own email/password):
-- insert into users (email, password_hash)
-- values ('admin@example.com', crypt('choose-a-strong-password', gen_salt('bf')));
