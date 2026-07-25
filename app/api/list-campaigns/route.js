import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const pageNum = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const requestedSize = parseInt(searchParams.get('pageSize') || '10', 10);
  const size = [10, 25, 50].includes(requestedSize) ? requestedSize : 10;
  const from = (pageNum - 1) * size;
  const to = from + size - 1;

  const campaignName = searchParams.get('campaignName');
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');

  let query = supabase
    .from('campaigns')
    .select('campaign_name, button_name, flow_type, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (campaignName) query = query.ilike('campaign_name', `%${campaignName}%`);
  if (fromDate) query = query.gte('created_at', `${fromDate}T00:00:00.000Z`);
  if (toDate) query = query.lte('created_at', `${toDate}T23:59:59.999Z`);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data, total: count, page: pageNum, pageSize: size });
}
