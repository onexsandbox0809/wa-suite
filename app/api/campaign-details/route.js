import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const buttonName = searchParams.get('button_name');
  const campaignName = searchParams.get('campaign_name');

  let query = supabase.from('campaigns').select('*');

  if (buttonName) {
    query = query.eq('button_name', buttonName);
  } else if (campaignName) {
    query = query.eq('campaign_name', campaignName).order('created_at', { ascending: false }).limit(1);
  } else {
    // No identifier supplied -> return the most recently created campaign
    query = query.order('created_at', { ascending: false }).limit(1);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No matching campaign found' }, { status: 404 });
  }

  return NextResponse.json(data[0]);
}
