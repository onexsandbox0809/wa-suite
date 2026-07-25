-- ============================================================================
-- MIGRATION for an ALREADY-LIVE database (tables already exist).
-- Safe to run multiple times -- every statement is idempotent (CREATE OR
-- REPLACE / IF NOT EXISTS everywhere). Run this in Supabase -> SQL Editor.
-- ============================================================================

-- ---- 1. New campaign columns (points 2, 3, 4) -------------------------------
alter table campaigns add column if not exists l1_cta_name text;
alter table campaigns add column if not exists l2_cta_name text;
alter table campaigns add column if not exists l12_button_bridge_name text;

-- ---- 2. Indexes needed for the reporting functions to run fast at scale ----
create index if not exists idx_links_campaign_button_name on links(campaign_button_name);
create index if not exists idx_links_created_at on links(created_at desc);
create index if not exists idx_clicks_link_id_clicked_at on clicks(link_id, clicked_at desc);
create index if not exists idx_campaigns_button_name on campaigns(button_name);

-- ---- 3. Reporting RPC functions (point 1 + point 5) -------------------------
-- Replaces the old approach of fetching all links + all clicks into the Node
-- app and grouping in JS, which does not scale past a few thousand rows.
-- These do the aggregation/pagination inside Postgres, so the API only ever
-- transfers the page of rows actually being displayed.

create or replace function get_click_summary(
  p_mobile text default null,
  p_campaign_button_name text default null
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
  left join clicks c on c.link_id = l.id
  where (p_mobile is null or l.mobile_number ilike '%' || p_mobile || '%')
    and (p_campaign_button_name is null or l.campaign_button_name ilike '%' || p_campaign_button_name || '%')
  group by coalesce(l.campaign_button_name, '(no campaign button)')
  order by total_clicks desc nulls last;
$$;

create or replace function get_links_report(
  p_mobile text default null,
  p_campaign_button_name text default null,
  p_exact boolean default false,
  p_page int default 1,
  p_page_size int default 25
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
  ) cs on true
  order by f.created_at desc
  limit p_page_size offset (p_page - 1) * p_page_size;
$$;

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
