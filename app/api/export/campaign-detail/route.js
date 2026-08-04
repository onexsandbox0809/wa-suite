import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../../lib/dateRange';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds -- max allowed on Vercel Hobby; Pro/Enterprise allow up to 300s

const BATCH_SIZE = 5000; // fewer round trips for very large exports
const XLSX_CAP = 150000; // comfortably covers 100k+ rows

const COLUMNS = [
  { key: 'campaign_button_name', header: 'Campaign Button' },
  { key: 'mobile_number', header: 'Mobile' },
  { key: 'short_link', header: 'Short Link' },
  { key: 'long_url', header: 'Destination' },
  { key: 'total_clicks', header: 'Clicks' },
  { key: 'unique_clicks', header: 'Unique' },
  { key: 'last_clicked_at', header: 'Last Click' },
  { key: 'created_at', header: 'Created' },
  { key: 'clicked_at', header: 'When' },
  { key: 'ip', header: 'IP' },
  { key: 'location', header: 'Location' },
  { key: 'user_agent', header: 'Device' },
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function formatDate(iso) { return iso ? new Date(iso).toISOString() : ''; }

function toRow(r, baseUrl, campaignButtonName) {
  return {
    campaign_button_name: campaignButtonName,
    mobile_number: r.mobile_number,
    short_link: `${baseUrl}/${r.code}`,
    long_url: r.long_url,
    total_clicks: r.total_clicks,
    unique_clicks: r.unique_clicks,
    last_clicked_at: formatDate(r.last_clicked_at),
    created_at: formatDate(r.created_at),
    clicked_at: formatDate(r.clicked_at),
    ip: r.ip || '',
    location: [r.city, r.country].filter(Boolean).join(', '),
    user_agent: r.user_agent || '',
  };
}

// mobile defaults to null so the row-level Report buttons (which don't pass
// it) export the COMPLETE dataset. The recipient modal passes it explicitly
// for an "export what I'm looking at" option.
async function* fetchAllRows(campaignButtonName, hardCap, start, end, mobile) {
  let page = 1;
  let fetched = 0;
  while (true) {
    const { data, error } = await supabase.rpc('get_campaign_click_detail', {
      p_campaign_button_name: campaignButtonName,
      p_page: page,
      p_page_size: BATCH_SIZE,
      p_start_date: start,
      p_end_date: end,
      p_mobile: mobile,
    });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return;

    for (const row of data) {
      if (hardCap && fetched >= hardCap) return;
      yield row;
      fetched++;
    }
    if (data.length < BATCH_SIZE) return;
    if (hardCap && fetched >= hardCap) return;
    page++;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = (searchParams.get('format') || 'csv').toLowerCase();
  const campaignButtonName = searchParams.get('campaign_button_name');
  const mobile = searchParams.get('mobile') || null;
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (!campaignButtonName) {
    return NextResponse.json({ error: 'campaign_button_name is required' }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
  const safeName = campaignButtonName.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Click Detail');
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));

    let count = 0;
    let truncated = false;
    try {
      for await (const row of fetchAllRows(campaignButtonName, XLSX_CAP + 1, start, end, mobile)) {
        if (count >= XLSX_CAP) { truncated = true; break; }
        sheet.addRow(toRow(row, baseUrl, campaignButtonName));
        count++;
      }
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }

    if (truncated) {
      sheet.addRow({});
      sheet.addRow({ mobile_number: `⚠ Export capped at ${XLSX_CAP.toLocaleString()} rows — use "Download CSV" for the complete dataset.` });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="clicker-detail-${safeName}-${stamp}.xlsx"`,
      },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(COLUMNS.map((c) => c.header).join(',') + '\n'));
        for await (const row of fetchAllRows(campaignButtonName, null, start, end, mobile)) {
          const r = toRow(row, baseUrl, campaignButtonName);
          const line = COLUMNS.map((c) => csvEscape(r[c.key])).join(',') + '\n';
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clicker-detail-${safeName}-${stamp}.csv"`,
    },
  });
}