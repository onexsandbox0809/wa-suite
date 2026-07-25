import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

// Paginated click log for a single short link -- used by the "Show Clicks"
// modal. Deliberately separate from /api/links so opening the modal never
// has to pull more than one page of click rows, even if that link has
// millions of clicks.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const requestedSize = parseInt(searchParams.get('pageSize') || '50', 10);
  const pageSize = Math.min(200, Math.max(1, requestedSize || 50));

  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('get_link_clicks', {
    p_code: code,
    p_page: page,
    p_page_size: pageSize,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = data && data.length > 0 ? Number(data[0].total_count) : 0;

  return NextResponse.json({
    clicks: (data || []).map(({ total_count, ...row }) => row),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}
