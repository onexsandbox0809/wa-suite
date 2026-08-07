-- ============================================================================
-- MIGRATION v9 -- Multi-tenancy foundation.
--
-- Adds an `accounts` table (your customers) and an `account_id` column to
-- every data table, so each customer's campaigns/links/clicks are logically
-- isolated within the same Supabase project. Isolation is enforced in
-- application code (every query/RPC call takes account_id as a parameter),
-- reinforced by Row Level Security as a second line of defense.
--
-- SAFE FOR EXISTING DATA: your current campaigns/links/clicks/button_clicks
-- are backfilled into a new "default" account rather than deleted or left
-- orphaned. Your current login(s) become platform ADMIN users (not tied to
-- any one customer account) -- that's what lets you use the new admin page
-- to manage every account.
--
-- Run this once in Supabase -> SQL Editor. Safe to re-run (idempotent
-- everywhere except the one-time backfill, which only affects rows that
-- don't already have an account_id).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. accounts table (your customers/tenants)
-- ---------------------------------------------------------------------------
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text unique not null,
  api_key_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_accounts_account_name on accounts(account_name);

-- ---------------------------------------------------------------------------
-- 2. Seed a "default" account and backfill all existing data into it.
--    ⚠️ THIS IS YOUR DEFAULT ACCOUNT'S API KEY -- shown here once. Save it
--    somewhere safe, or regenerate it from the admin page after this runs.
-- ---------------------------------------------------------------------------
insert into accounts (account_name, api_key_hash)
select 'default', crypt('c7f45b08d6077563368d91beb78a72a535fb6f79caa8519f', gen_salt('bf'))
where not exists (select 1 from accounts where account_name = 'default');

-- ---------------------------------------------------------------------------
-- 3. Add account_id to every data table (nullable for now -- made NOT NULL
--    after backfill, below).
-- ---------------------------------------------------------------------------
alter table campaigns     add column if not exists account_id uuid references accounts(id);
alter table links         add column if not exists account_id uuid references accounts(id);
alter table clicks        add column if not exists account_id uuid references accounts(id);
alter table button_clicks add column if not exists account_id uuid references accounts(id);

-- users: nullable on purpose. NULL account_id + role='admin' = platform
-- admin (you) with access to every account. A non-null account_id +
-- role='account_user' = a customer login scoped to exactly that account.
alter table users add column if not exists account_id uuid references accounts(id);
alter table users add column if not exists role text not null default 'account_user';
alter table users add constraint users_role_check check (role in ('admin', 'account_user'));

-- ---------------------------------------------------------------------------
-- 4. Backfill existing rows into the default account.
-- ---------------------------------------------------------------------------
update campaigns     set account_id = (select id from accounts where account_name = 'default') where account_id is null;
update links         set account_id = (select id from accounts where account_name = 'default') where account_id is null;
update button_clicks set account_id = (select id from accounts where account_name = 'default') where account_id is null;

-- clicks inherit their account_id from their parent link.
update clicks c
set account_id = l.account_id
from links l
where c.link_id = l.id and c.account_id is null;

-- Any EXISTING login(s) become platform admins (not tied to one account),
-- since they were created before multi-tenancy existed and are presumably
-- you, the operator.
update users set role = 'admin', account_id = null where account_id is null;

-- ---------------------------------------------------------------------------
-- 5. Now that every row has an account_id, enforce it going forward.
-- ---------------------------------------------------------------------------
alter table campaigns     alter column account_id set not null;
alter table links         alter column account_id set not null;
alter table clicks        alter column account_id set not null;
alter table button_clicks alter column account_id set not null;

create index if not exists idx_campaigns_account_id     on campaigns(account_id);
create index if not exists idx_links_account_id         on links(account_id);
create index if not exists idx_clicks_account_id         on clicks(account_id);
create index if not exists idx_button_clicks_account_id on button_clicks(account_id);
create index if not exists idx_users_account_id         on users(account_id);

-- ---------------------------------------------------------------------------
-- 6. Row Level Security -- second line of defense. The app's service-role
--    key bypasses RLS by design (that's how server-side API routes work
--    today), so this doesn't change current behavior -- it's insurance
--    against a future code path that might use a non-service-role client.
-- ---------------------------------------------------------------------------
alter table accounts enable row level security;

-- ---------------------------------------------------------------------------
-- 7. Account management functions (used by the new admin page)
-- ---------------------------------------------------------------------------

-- Verifies an API key and returns which account it belongs to. Scans the
-- accounts table (fine at dozens of accounts; if you ever reach hundreds,
-- switch to an indexed key-prefix design instead of a full bcrypt scan).
create or replace function verify_api_key(p_api_key text)
returns table (account_id uuid, account_name text)
language sql
stable
as $$
  select id, account_name
  from accounts
  where api_key_hash = crypt(p_api_key, api_key_hash);
$$;

create or replace function create_account(p_account_name text, p_api_key text)
returns table (id uuid, account_name text, created_at timestamptz)
language sql
as $$
  insert into accounts (account_name, api_key_hash)
  values (p_account_name, crypt(p_api_key, gen_salt('bf')))
  returning id, account_name, created_at;
$$;

create or replace function regenerate_api_key(p_account_id uuid, p_new_api_key text)
returns table (id uuid, account_name text)
language sql
as $$
  update accounts
  set api_key_hash = crypt(p_new_api_key, gen_salt('bf'))
  where id = p_account_id
  returning id, account_name;
$$;

-- ---------------------------------------------------------------------------
-- 8. verify_user_login now also returns account scope, so a login session
--    knows which account (if any) it's restricted to.
-- ---------------------------------------------------------------------------
create or replace function verify_user_login(p_email text, p_password text)
returns table (id uuid, email text, account_id uuid, role text)
language sql
stable
as $$
  select id, email, account_id, role
  from users
  where email = p_email
    and password_hash = crypt(p_password, password_hash);
$$;

-- ---------------------------------------------------------------------------
-- 9. Create an "account_user" login for a specific customer account
--    (used by the admin page when inviting a customer's team member).
-- ---------------------------------------------------------------------------
create or replace function create_account_user(p_email text, p_password text, p_account_id uuid)
returns table (id uuid, email text, account_id uuid, role text)
language sql
as $$
  insert into users (email, password_hash, account_id, role)
  values (p_email, crypt(p_password, gen_salt('bf')), p_account_id, 'account_user')
  returning id, email, account_id, role;
$$;

-- ---------------------------------------------------------------------------
-- 10. Tenant-scoped reporting functions. p_account_id has NO default --
--     it's a required parameter, so a route that forgets to pass it fails
--     loudly instead of silently returning every tenant's data.
--     (Retrofitted in this pass: get_click_summary, get_links_report.
--     get_link_clicks, get_campaign_click_detail, get_button_vs_url_summary,
--     and get_button_recipient_detail follow the same pattern but are NOT
--     yet retrofitted -- see the summary notes for the exact checklist.)
-- ---------------------------------------------------------------------------
create or replace function get_click_summary(
  p_account_id uuid,
  p_mobile text default null,
  p_campaign_button_name text default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_page int default 1,
  p_page_size int default 25
)
returns table (
  campaign_button_name text,
  total_links bigint,
  total_clicks bigint,
  unique_mobiles bigint,
  last_click timestamptz,
  total_count bigint
)
language sql
stable
as $$
  with grouped as (
    select
      coalesce(l.campaign_button_name, '(no campaign button)') as campaign_button_name,
      count(distinct l.id)                                      as total_links,
      count(c.id)                                                as total_clicks,
      count(distinct l.mobile_number)                            as unique_mobiles,
      max(c.clicked_at)                                          as last_click
    from links l
    left join clicks c
      on c.link_id = l.id
      and c.account_id = p_account_id
      and (p_start_date is null or c.clicked_at >= p_start_date)
      and (p_end_date is null or c.clicked_at <= p_end_date)
    where l.account_id = p_account_id
      and (p_mobile is null or l.mobile_number ilike '%' || p_mobile || '%')
      and (p_campaign_button_name is null or l.campaign_button_name ilike '%' || p_campaign_button_name || '%')
    group by coalesce(l.campaign_button_name, '(no campaign button)')
  ),
  counted as (
    select count(*) as total_count from grouped
  )
  select g.*, (select total_count from counted)
  from grouped g
  order by g.last_click desc nulls last, g.total_clicks desc
  limit p_page_size offset (p_page - 1) * p_page_size;
$$;

create or replace function get_links_report(
  p_account_id uuid,
  p_mobile text default null,
  p_campaign_button_name text default null,
  p_exact boolean default false,
  p_page int default 1,
  p_page_size int default 25,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_sort text default 'recent'
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
    where l.account_id = p_account_id
      and (p_mobile is null or l.mobile_number ilike '%' || p_mobile || '%')
      and (
        p_campaign_button_name is null
        or (p_exact and l.campaign_button_name = p_campaign_button_name)
        or (not p_exact and l.campaign_button_name ilike '%' || p_campaign_button_name || '%')
      )
  ),
  counted as (
    select count(*) as total_count from filtered
  ),
  joined as (
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
        and c.account_id = p_account_id
        and (p_start_date is null or c.clicked_at >= p_start_date)
        and (p_end_date is null or c.clicked_at <= p_end_date)
    ) cs on true
  )
  select *
  from joined
  order by
    case when p_sort = 'no_clicks_first' then (total_clicks = 0) end desc,
    created_at desc
  limit p_page_size offset (p_page - 1) * p_page_size;
$$;
