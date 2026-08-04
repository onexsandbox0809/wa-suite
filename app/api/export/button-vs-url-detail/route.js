import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../../lib/dateRange';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds -- max allowed on Vercel Hobby; Pro/Enterprise allow up to 300s

const BATCH_SIZE = 5000; // fewer round trips for very large exports
const XLSX_CAP = 150000; // comfortably covers 100k+ rows

const COLUMNS = [
  { key: 'button_name', header: 'Campaign Button' },
  { key: 'mobile_number', header: 'Mobile' },
  { key: 'button_click', header: 'Button Click' },
  { key: 'url_click', header: 'URL Click' },
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function formatDate(iso) { return iso ? new Date(iso).toISOString() : ''; }
function toRow(r, buttonName) {
  return {
    button_name: buttonName,
    mobile_number: r.mobile_number,
    button_click: formatDate(r.button_click),
    url_click: formatDate(r.url_click), // blank if they tapped the button but never clicked the URL
  };
}

// only_not_clicked/search_mobile default to "off" so the row-level Report
// buttons (which don't pass them) export the COMPLETE dataset. The
// recipient modal passes them explicitly for an "export what I'm looking
// at" option.
async function* fetchAllRows(buttonName, hardCap, start, end, onlyNotClicked, searchMobile, sort) {
  let page = 1;
  let fetched = 0;
  while (true) {
    const { data, error } = await supabase.rpc('get_button_recipient_detail', {
      p_button_name: buttonName,
      p_page: page,
      p_page_size: BATCH_SIZE,
      p_start_date: start,
      p_end_date: end,
      p_only_not_clicked: onlyNotClicked,
      p_search_mobile: searchMobile,
      p_sort: sort,
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
  const onlyNotClicked = searchParams.get('only_not_clicked') === 'true';
  const searchMobile = searchParams.get('search_mobile') || null;
  const sort = searchParams.get('sort') === 'not_clicked_first' ? 'not_clicked_first' : 'recent';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (!buttonName) {
    return NextResponse.json({ error: 'button_name is required' }, { status: 400 });
  }

  const safeName = buttonName.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Button vs URL Detail');
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 24 }));

    let count = 0;
    let truncated = false;
    try {
      for await (const row of fetchAllRows(buttonName, XLSX_CAP + 1, start, end, onlyNotClicked, searchMobile, sort)) {
        if (count >= XLSX_CAP) { truncated = true; break; }
        sheet.addRow(toRow(row, buttonName));
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
        'Content-Disposition': `attachment; filename="button-vs-url-detail-${safeName}-${stamp}.xlsx"`,
      },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(COLUMNS.map((c) => c.header).join(',') + '\n'));
        for await (const row of fetchAllRows(buttonName, null, start, end, onlyNotClicked, searchMobile, sort)) {
          const r = toRow(row, buttonName);
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
      'Content-Disposition': `attachment; filename="button-vs-url-detail-${safeName}-${stamp}.csv"`,
    },
  });
}