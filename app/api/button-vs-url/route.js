import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../lib/dateRange';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const buttonName = searchParams.get('button_name') || null;
  const mobileNumber = searchParams.get('mobile_number') || null;
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const requestedSize = parseInt(searchParams.get('pageSize') || '25', 10);
  const pageSize = Math.min(100, Math.max(1, requestedSize || 25));

  const { data, error } = await supabase.rpc('get_button_vs_url_summary', {
    p_button_name: buttonName,
    p_start_date: start,
    p_end_date: end,
    p_mobile_number: mobileNumber,
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
