import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../lib/dateRange';

// Grouped, DB-side-aggregated summary -- one row per campaign_button_name.
// "Unique" here = distinct mobile numbers a link was ever created for
// (recipient-level), not distinct IPs. Ordered newest-activity-first, and
// now paginated so the summary table itself scales past a handful of
// campaign buttons.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mobile = searchParams.get('mobile') || null;
  const campaignButtonName = searchParams.get('campaign_button_name') || null;
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const requestedSize = parseInt(searchParams.get('pageSize') || '25', 10);
  const pageSize = Math.min(100, Math.max(1, requestedSize || 25));

  const { data, error } = await supabase.rpc('get_click_summary', {
    p_mobile: mobile,
    p_campaign_button_name: campaignButtonName,
    p_start_date: start,
    p_end_date: end,
    p_page: page,
    p_page_size: pageSize,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = data && data.length > 0 ? Number(data[0].total_count) : 0;

  return NextResponse.json({
    summary: (data || []).map(({ total_count, ...row }) => row),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
