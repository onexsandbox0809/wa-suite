import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../../lib/dateRange';

export const runtime = 'nodejs';

const BATCH_SIZE = 1000;
const XLSX_CAP = 50000;

const COLUMNS = [
  { key: 'mobile_number', header: 'Mobile' },
  { key: 'button_taps', header: 'Button Taps' },
  { key: 'first_button_click', header: 'First Button Click' },
  { key: 'last_button_click', header: 'Last Button Click' },
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function formatDate(iso) { return iso ? new Date(iso).toISOString() : ''; }
function toRow(r) {
  return {
    mobile_number: r.mobile_number,
    button_taps: r.button_taps,
    first_button_click: formatDate(r.first_button_click),
    last_button_click: formatDate(r.last_button_click),
  };
}

async function* fetchAllRows(buttonName, hardCap, start, end) {
  let page = 1;
  let fetched = 0;
  while (true) {
    const { data, error } = await supabase.rpc('get_button_not_url_detail', {
      p_button_name: buttonName,
      p_page: page,
      p_page_size: BATCH_SIZE,
      p_start_date: start,
      p_end_date: end,
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
  const buttonName = searchParams.get('button_name');
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (!buttonName) {
    return NextResponse.json({ error: 'button_name is required' }, { status: 400 });
  }

  const safeName = buttonName.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Not Converted');
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 22 }));

    let count = 0;
    let truncated = false;
    try {
      for await (const row of fetchAllRows(buttonName, XLSX_CAP + 1, start, end)) {
        if (count >= XLSX_CAP) { truncated = true; break; }
        sheet.addRow(toRow(row));
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
        'Content-Disposition': `attachment; filename="button-not-url-${safeName}-${stamp}.xlsx"`,
      },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(COLUMNS.map((c) => c.header).join(',') + '\n'));
        for await (const row of fetchAllRows(buttonName, null, start, end)) {
          const r = toRow(row);
          controller.enqueue(encoder.encode(COLUMNS.map((c) => csvEscape(r[c.key])).join(',') + '\n'));
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
      'Content-Disposition': `attachment; filename="button-not-url-${safeName}-${stamp}.csv"`,
    },
  });
}
