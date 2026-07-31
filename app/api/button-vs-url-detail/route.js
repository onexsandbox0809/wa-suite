import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../lib/dateRange';

// Full per-recipient view for one button: Mobile | Button Click | URL Click.
// Includes everyone who tapped the button -- url_click is null for anyone
// who tapped but never clicked through.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const buttonName = searchParams.get('button_name');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const requestedSize = parseInt(searchParams.get('pageSize') || '50', 10);
  const pageSize = Math.min(200, Math.max(1, requestedSize || 50));
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));

  if (!buttonName) {
    return NextResponse.json({ error: 'button_name is required' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('get_button_recipient_detail', {
    p_button_name: buttonName,
    p_page: page,
    p_page_size: pageSize,
    p_start_date: start,
    p_end_date: end,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = data && data.length > 0 ? Number(data[0].total_count) : 0;

  return NextResponse.json({
    recipients: (data || []).map(({ total_count, ...row }) => row),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
