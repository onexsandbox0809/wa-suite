import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

// Purpose-built endpoint for logging a "button click" (a WhatsApp button
// tap, as reported by your automation) -- separate from /api/campaign-details
// so you can fire this independently of fetching the campaign's full
// message config. Public, like /api/create and /api/campaign-details --
// not gated by login, since it's meant to be called by your bot.
//
// Accepts either GET (query params) or POST (JSON body) with the same two
// fields:
//   button_name    required  -- must match an existing campaign's button_name
//   mobile_number  optional  -- strongly recommended; without it, this click
//                                only counts toward the aggregate totals on
//                                the Button vs URL report, not the
//                                per-recipient "clicked button, not URL"
//                                drill-down.

async function logClick(buttonName, mobileNumber) {
  if (!buttonName || typeof buttonName !== 'string') {
    return { error: 'button_name is required', status: 400 };
  }

  // Confirm the button_name matches a real campaign, to catch typos early
  // rather than silently logging clicks for a button that doesn't exist.
  const { data: campaign, error: lookupError } = await supabase
    .from('campaigns')
    .select('button_name')
    .eq('button_name', buttonName)
    .maybeSingle();

  if (lookupError) return { error: lookupError.message, status: 500 };
  if (!campaign) return { error: `No campaign found with button_name "${buttonName}"`, status: 404 };

  const { error: insertError } = await supabase.from('button_clicks').insert({
    button_name: buttonName,
    mobile_number: mobileNumber || null,
  });

  if (insertError) return { error: insertError.message, status: 500 };

  return {
    data: {
      ok: true,
      button_name: buttonName,
      mobile_number: mobileNumber || null,
      logged_at: new Date().toISOString(),
    },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const buttonName = searchParams.get('button_name');
  const mobileNumber = searchParams.get('mobile_number');

  const result = await logClick(buttonName, mobileNumber);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201 });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const result = await logClick(body?.button_name, body?.mobile_number);
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { status: 201 });
}
