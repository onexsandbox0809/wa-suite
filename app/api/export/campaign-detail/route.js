import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';

export const runtime = 'nodejs';

const BATCH_SIZE = 1000;
const XLSX_CAP = 50000;

const COLUMNS = [
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

function toRow(r, baseUrl) {
  return {
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

async function* fetchAllRows(campaignButtonName, hardCap) {
  let page = 1;
  let fetched = 0;
  while (true) {
    const { data, error } = await supabase.rpc('get_campaign_click_detail', {
      p_campaign_button_name: campaignButtonName,
      p_page: page,
      p_page_size: BATCH_SIZE,
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
      for await (const row of fetchAllRows(campaignButtonName, XLSX_CAP + 1)) {
        if (count >= XLSX_CAP) { truncated = true; break; }
        sheet.addRow(toRow(row, baseUrl));
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
        for await (const row of fetchAllRows(campaignButtonName, null)) {
          const r = toRow(row, baseUrl);
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
