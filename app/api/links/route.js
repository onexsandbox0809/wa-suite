import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../lib/dateRange';

// Paginated, DB-side-aggregated link report. Backed by the get_links_report()
// Postgres function so this stays fast at any scale -- it only ever
// transfers the current page of rows, never the whole table.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mobile = searchParams.get('mobile') || null;
  const campaignButtonName = searchParams.get('campaign_button_name') || null;
  const exact = searchParams.get('exact') === 'true';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const requestedSize = parseInt(searchParams.get('pageSize') || '25', 10);
  const pageSize = Math.min(100, Math.max(1, requestedSize || 25));
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));
  const sort = searchParams.get('sort') === 'no_clicks_first' ? 'no_clicks_first' : 'recent';

  const { data, error } = await supabase.rpc('get_links_report', {
    p_mobile: mobile,
    p_campaign_button_name: campaignButtonName,
    p_exact: exact,
    p_page: page,
    p_page_size: pageSize,
    p_start_date: start,
    p_end_date: end,
    p_sort: sort,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = data && data.length > 0 ? Number(data[0].total_count) : 0;

  return NextResponse.json({
    links: (data || []).map(({ total_count, ...row }) => row),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
