import { supabase } from '../../../../lib/supabaseClient';
import { toDateRangeBounds } from '../../../../lib/dateRange';

export const runtime = 'nodejs';
export const maxDuration = 60;

const COLUMNS = [
  { key: 'campaign_button_name', header: 'Campaign Button' },
  { key: 'total_links', header: 'Links Sent' },
  { key: 'total_clicks', header: 'Total Clicks' },
  { key: 'unique_mobiles', header: 'Unique Recipient Clicked' },
  { key: 'last_click', header: 'Last Click' },
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function formatDate(iso) { return iso ? new Date(iso).toISOString() : ''; }

// Summary rows are naturally small (one per campaign button name), so no
// pagination/cap is needed here -- this always returns the complete set.
async function fetchSummary(mobile, campaignButtonName, start, end) {
  const { data, error } = await supabase.rpc('get_click_summary', {
    p_mobile: mobile,
    p_campaign_button_name: campaignButtonName,
    p_start_date: start,
    p_end_date: end,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = (searchParams.get('format') || 'csv').toLowerCase();
  const mobile = searchParams.get('mobile') || null;
  const campaignButtonName = searchParams.get('campaign_button_name') || null;
  const { start, end } = toDateRangeBounds(searchParams.get('start_date'), searchParams.get('end_date'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  let rows;
  try {
    rows = await fetchSummary(mobile, campaignButtonName, start, end);
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (format === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Summary');
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: 26 }));
    rows.forEach((row) => {
      sheet.addRow({
        campaign_button_name: row.campaign_button_name,
        total_links: row.total_links,
        total_clicks: row.total_clicks,
        unique_mobiles: row.unique_mobiles,
        last_click: formatDate(row.last_click),
      });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="clicker-summary-${stamp}.xlsx"`,
      },
    });
  }

  const lines = [COLUMNS.map((c) => c.header).join(',')];
  rows.forEach((row) => {
    lines.push([
      csvEscape(row.campaign_button_name),
      row.total_links,
      row.total_clicks,
      row.unique_mobiles,
      csvEscape(formatDate(row.last_click)),
    ].join(','));
  });

  return new Response(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clicker-summary-${stamp}.csv"`,
    },
  });
}
