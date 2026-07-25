import { NextResponse } from 'next/server';
import { supabase } from '../../lib/supabaseClient';

export async function GET(request, { params }) {
  const { code } = params;

  const { data: link, error } = await supabase
    .from('links')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (error || !link) {
    return NextResponse.redirect(new URL('/not-found', request.url));
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null;
  const user_agent = request.headers.get('user-agent') || null;
  const referrer = request.headers.get('referer') || null;
  // These headers are populated automatically when deployed on Vercel.
  const country = request.headers.get('x-vercel-ip-country') || null;
  const city = request.headers.get('x-vercel-ip-city') || null;

  // Fire-and-forget style, but we still await so we don't lose the write on
  // serverless functions that freeze immediately after the response is sent.
  await supabase.from('clicks').insert({
    link_id: link.id,
    ip,
    user_agent,
    referrer,
    country,
    city,
  });

  return NextResponse.redirect(link.long_url, { status: 302 });
}
