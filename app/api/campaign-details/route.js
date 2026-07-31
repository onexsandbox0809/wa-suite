import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

// Called by your WhatsApp automation whenever a recipient taps the button --
// this is the only signal we get for a "button click" (WhatsApp doesn't
// report button taps to us directly). Every successful lookup is logged to
// button_clicks for the new "Button Click vs URL Clicks" report.
//
// OPTIONAL but recommended: pass &mobile_number=<recipient> on this call if
// your automation has it at this point. Without it, we can still count total
// button taps, but can't tell WHICH specific recipient tapped the button
// without following through to the URL -- only the aggregate gap.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const buttonName = searchParams.get('button_name');
  const campaignName = searchParams.get('campaign_name');
  const mobileNumber = searchParams.get('mobile_number') || null;

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

  const campaign = data[0];

  // Log the button-click event. Awaited for reliability (consistent with how
  // link clicks are logged), but kept to a single lightweight insert so it
  // doesn't add meaningful latency to your bot's response.
  await supabase.from('button_clicks').insert({
    button_name: campaign.button_name,
    mobile_number: mobileNumber,
  });

  return NextResponse.json(campaign);
}
