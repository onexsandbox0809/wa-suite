import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../lib/dateRange';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const buttonName = searchParams.get('button_name') || null;
  const mobileNumber = searchParams.get('mobile_number') || null;
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));

  const { data, error } = await supabase.rpc('get_button_vs_url_summary', {
    p_button_name: buttonName,
    p_start_date: start,
    p_end_date: end,
    p_mobile_number: mobileNumber,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ summary: data || [] });
}
