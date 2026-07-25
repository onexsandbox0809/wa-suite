import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';

export const runtime = 'nodejs';

const BATCH_SIZE = 1000;
const XLSX_CAP = 50000;

const COLUMNS = [
  { key: 'mobile_number', header: 'Mobile' },
  { key: 'campaign_button_name', header: 'Campaign Button' },
  { key: 'code', header: 'Short Code' },
  { key: 'long_url', header: 'Destination URL' },
  { key: 'total_clicks', header: 'Total Clicks' },
  { key: 'unique_clicks', header: 'Unique Clicks (by IP)' },
  { key: 'last_clicked_at', header: 'Last Click' },
  { key: 'created_at', header: 'Created' },
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function formatDate(iso) {
  return iso ? new Date(iso).toISOString() : '';
}

async function* fetchAllRows(mobile, campaignButtonName, exact, hardCap) {
  let page = 1;
  let fetched = 0;
  while (true) {
    const { data, error } = await supabase.rpc('get_links_report', {
      p_mobile: mobile,
      p_campaign_button_name: campaignButtonName,
      p_exact: exact,
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
  const mobile = searchParams.get('mobile') || null;
  const campaignButtonName = searchParams.get('campaign_button_name') || null;
  const exact = searchParams.get('exact') === 'true';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'xlsx') {
    return exportXlsx(mobile, campaignButtonName, exact, stamp);
  }
  return exportCsv(mobile, campaignButtonName, exact, stamp);
}

// ---------------------------------------------------------------------------
// CSV: true streaming, no row cap. Batches of 1,000 rows are pulled from
// Postgres and written to the response as they arrive, so memory use stays
// flat regardless of whether the dataset is 100 rows or 1,000,000.
// ---------------------------------------------------------------------------
function exportCsv(mobile, campaignButtonName, exact, stamp) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(COLUMNS.map((c) => c.header).join(',') + '\n'));

        for await (const row of fetchAllRows(mobile, campaignButtonName, exact, null)) {
          const line = [
            csvEscape(row.mobile_number),
            csvEscape(row.campaign_button_name),
            csvEscape(row.code),
            csvEscape(row.long_url),
            row.total_clicks,
            row.unique_clicks,
            csvEscape(formatDate(row.last_clicked_at)),
            csvEscape(formatDate(row.created_at)),
          ].join(',') + '\n';
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
      'Content-Disposition': `attachment; filename="clicker-data-${stamp}.csv"`,
    },
  });
}

// ---------------------------------------------------------------------------
// Excel: capped at 50,000 rows. A true streaming .xlsx writer exists
// (exceljs's WorkbookWriter) but adds real complexity for a format that
// Excel/Sheets users rarely need beyond tens of thousands of rows anyway --
// for a genuinely huge export, CSV (above) is the efficient, uncapped path
// and opens in Excel just fine. If truncated, a warning row is appended.
// ---------------------------------------------------------------------------
async function exportXlsx(mobile, campaignButtonName, exact, stamp) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clicker Data');
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));

  let count = 0;
  let truncated = false;
  try {
    for await (const row of fetchAllRows(mobile, campaignButtonName, exact, XLSX_CAP + 1)) {
      if (count >= XLSX_CAP) {
        truncated = true;
        break;
      }
      sheet.addRow({
        mobile_number: row.mobile_number,
        campaign_button_name: row.campaign_button_name,
        code: row.code,
        long_url: row.long_url,
        total_clicks: row.total_clicks,
        unique_clicks: row.unique_clicks,
        last_clicked_at: formatDate(row.last_clicked_at),
        created_at: formatDate(row.created_at),
      });
      count++;
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  if (truncated) {
    sheet.addRow({});
    sheet.addRow({
      mobile_number: `⚠ Export capped at ${XLSX_CAP.toLocaleString()} rows — use "Download CSV" for the complete dataset.`,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="clicker-data-${stamp}.xlsx"`,
    },
  });
}
