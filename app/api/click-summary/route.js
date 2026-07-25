import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

// Grouped, DB-side-aggregated summary -- one row per campaign_button_name.
// "Unique" here = distinct mobile numbers a link was ever created for
// (recipient-level), not distinct IPs.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const mobile = searchParams.get('mobile') || null;
  const campaignButtonName = searchParams.get('campaign_button_name') || null;

  const { data, error } = await supabase.rpc('get_click_summary', {
    p_mobile: mobile,
    p_campaign_button_name: campaignButtonName,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ summary: data || [] });
}
