import { supabase } from '../../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../../lib/dateRange';

export const runtime = 'nodejs';

const COLUMNS = [
  { key: 'button_name', header: 'Campaign Button' },
  { key: 'total_button_clicks', header: 'Total Button Clicks' },
  { key: 'unique_button_clickers', header: 'Unique Button Clickers' },
  { key: 'total_url_clicks', header: 'Total URL Clicks' },
  { key: 'unique_url_clickers', header: 'Unique URL Clickers' },
  { key: 'clicked_button_not_url', header: 'Clicked Button, Not URL' },
  { key: 'last_button_click', header: 'Last Button Click' },
  { key: 'last_url_click', header: 'Last URL Click' },
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function formatDate(iso) { return iso ? new Date(iso).toISOString() : ''; }

async function fetchSummary(buttonName, start, end) {
  const { data, error } = await supabase.rpc('get_button_vs_url_summary', {
    p_button_name: buttonName,
    p_start_date: start,
    p_end_date: end,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = (searchParams.get('format') || 'csv').toLowerCase();
  const buttonName = searchParams.get('button_name') || null;
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  let rows;
  try {
    rows = await fetchSummary(buttonName, start, end);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const toRow = (row) => ({
    button_name: row.button_name,
    total_button_clicks: row.total_button_clicks,
    unique_button_clickers: row.unique_button_clickers,
    total_url_clicks: row.total_url_clicks,
    unique_url_clickers: row.unique_url_clickers,
    clicked_button_not_url: row.clicked_button_not_url,
    last_button_click: formatDate(row.last_button_click),
    last_url_click: formatDate(row.last_url_click),
  });

  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Button vs URL');
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 24 }));
    rows.forEach((row) => sheet.addRow(toRow(row)));
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="button-vs-url-summary-${stamp}.xlsx"`,
      },
    });
  }

  const lines = [COLUMNS.map((c) => c.header).join(',')];
  rows.forEach((row) => {
    const r = toRow(row);
    lines.push(COLUMNS.map((c) => csvEscape(r[c.key])).join(','));
  });

  return new Response(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="button-vs-url-summary-${stamp}.csv"`,
    },
  });
}
