import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { supabase } from '../../../lib/supabaseClient';

// Unambiguous alphabet (no 0/O, 1/l/I confusion) — good for links read out loud or in WhatsApp.
const nanoid = customAlphabet(
  '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
  7
);

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const { long_url, mobile_number, label, campaign_button_name } = body || {};

  if (!long_url || typeof long_url !== 'string') {
    return NextResponse.json({ error: 'long_url is required' }, { status: 400 });
  }

  try {
    // Will throw if not a valid absolute URL.
    // eslint-disable-next-line no-new
    new URL(long_url);
  } catch {
    return NextResponse.json(
      { error: 'long_url must be a valid absolute URL, e.g. https://example.com/page' },
      { status: 400 }
    );
  }

  if (!mobile_number || typeof mobile_number !== 'string') {
    return NextResponse.json({ error: 'mobile_number is required' }, { status: 400 });
  }

  // Generate a unique code, retrying on the rare collision.
  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = nanoid();
    const { data: existing, error: lookupError } = await supabase
      .from('links')
      .select('id')
      .eq('code', candidate)
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 });
    }
    if (!existing) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    return NextResponse.json({ error: 'Could not generate a unique code, please retry' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('links')
    .insert({
      code,
      long_url,
      mobile_number,
      label: label || null,
      campaign_button_name: campaign_button_name || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
  const short_url = `${baseUrl}/${data.code}`;

  return NextResponse.json(
    {
      short_url,
      code: data.code,
      long_url: data.long_url,
      mobile_number: data.mobile_number,
      label: data.label,
      campaign_button_name: data.campaign_button_name,
      created_at: data.created_at,
    },
    { status: 201 }
  );
}
