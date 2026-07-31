const summaryBody = document.getElementById('summary-body');
const summaryEmpty = document.getElementById('summary-empty');
const summaryLoading = document.getElementById('summary-loading');

const fMobile = document.getElementById('f_mobile');
const fButton = document.getElementById('f_button');
const fStartDate = document.getElementById('f_start_date');
const fEndDate = document.getElementById('f_end_date');

const exportCsvLink = document.getElementById('export-csv');
const exportXlsxLink = document.getElementById('export-xlsx');

const SUMMARY_COLSPAN = 9;

function escapeHtml(s) {
  return (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
function fmtNum(n) { return (n ?? 0).toLocaleString(); }
function cssId(s) { return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_'); }

function currentFilters() {
  return {
    mobile_number: fMobile.value.trim(),
    button_name: fButton.value.trim(),
    start_date: fStartDate.value,
    end_date: fEndDate.value,
  };
}

function buildSummaryExportHref(format) {
  const { mobile_number, button_name, start_date, end_date } = currentFilters();
  const params = new URLSearchParams({ format });
  if (mobile_number) params.set('mobile_number', mobile_number);
  if (button_name) params.set('button_name', button_name);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);
  return `/api/export/button-vs-url?${params.toString()}`;
}

function buildDetailExportHref(buttonName, format) {
  const { start_date, end_date } = currentFilters();
  const params = new URLSearchParams({ button_name: buttonName, format });
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);
  return `/api/export/button-vs-url-detail?${params.toString()}`;
}

function refreshExportLinks() {
  exportCsvLink.href = buildSummaryExportHref('csv');
  exportXlsxLink.href = buildSummaryExportHref('xlsx');
}

async function loadSummary() {
  summaryLoading.style.display = 'block';
  summaryEmpty.style.display = 'none';
  summaryBody.innerHTML = '';
  refreshExportLinks();

  const { mobile_number, button_name, start_date, end_date } = currentFilters();
  const params = new URLSearchParams();
  if (mobile_number) params.set('mobile_number', mobile_number);
  if (button_name) params.set('button_name', button_name);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);

  try {
    const res = await fetch(`/api/button-vs-url?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load summary');
    renderSummary(data.summary || []);
  } catch (err) {
    summaryLoading.textContent = `Error: ${err.message}`;
    return;
  } finally {
    summaryLoading.style.display = 'none';
  }
}

function renderSummary(rows) {
  if (!rows.length) {
    summaryEmpty.style.display = 'block';
    return;
  }

  rows.forEach((row) => {
    const lastActivity = [row.last_button_click, row.last_url_click].filter(Boolean).sort().pop();
    const tr = document.createElement('tr');
    tr.className = 'summary-row';
    tr.innerHTML = `
      <td><span class="chevron">▶</span></td>
      <td style="font-family: var(--mono); font-size: 12px;" title="${escapeHtml(row.button_name)}">${escapeHtml(row.button_name)}</td>
      <td class="num">${fmtNum(row.total_button_clicks)}</td>
      <td class="num">${fmtNum(row.unique_button_clickers)}</td>
      <td class="num">${fmtNum(row.total_url_clicks)}</td>
      <td class="num">${fmtNum(row.unique_url_clickers)}</td>
      <td class="num"><span class="badge gap">${fmtNum(row.clicked_button_not_url)}</span></td>
      <td title="${escapeHtml(fmtDate(lastActivity))}">${fmtDate(lastActivity)}</td>
      <td class="report-cell">
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.button_name, 'csv')}" title="Download the not-converted recipient list (CSV) for this button">CSV</a>
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.button_name, 'xlsx')}" title="Download the not-converted recipient list (Excel, capped 50k) for this button">Excel</a>
      </td>
    `;
    tr.querySelectorAll('.report-cell a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
    tr.addEventListener('click', () => toggleDrilldown(row.button_name, tr));
    summaryBody.appendChild(tr);
  });
}

async function toggleDrilldown(buttonName, summaryTr) {
  const existing = document.getElementById(`drill-${cssId(buttonName)}`);
  const chevron = summaryTr.querySelector('.chevron');

  if (existing) {
    existing.remove();
    chevron.classList.remove('open');
    return;
  }

  document.querySelectorAll('.drill-row').forEach((el) => el.remove());
  document.querySelectorAll('.chevron.open').forEach((el) => el.classList.remove('open'));
  chevron.classList.add('open');

  const tr = document.createElement('tr');
  tr.className = 'drill-row';
  tr.id = `drill-${cssId(buttonName)}`;
  const td = document.createElement('td');
  td.colSpan = SUMMARY_COLSPAN;
  td.innerHTML = `<div class="drill-wrap loading">Loading recipients…</div>`;
  tr.appendChild(td);
  summaryTr.insertAdjacentElement('afterend', tr);

  try {
    const { start_date, end_date } = currentFilters();
    const params = new URLSearchParams({ button_name: buttonName, page: '1', pageSize: '50' });
    if (start_date) params.set('start_date', start_date);
    if (end_date) params.set('end_date', end_date);

    const res = await fetch(`/api/button-vs-url-detail?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load recipients');
    td.innerHTML = renderDrilldownTable(data.recipients || [], data.total || 0);
  } catch (err) {
    td.innerHTML = `<div class="drill-wrap"><span style="color:#b91c1c;">Error: ${escapeHtml(err.message)}</span></div>`;
  }
}

function renderDrilldownTable(recipients, total) {
  if (!recipients.length) {
    return `<div class="drill-wrap"><span class="muted">No recipients tapped the button without also clicking the URL — nice conversion. (Or no mobile_number was captured on the button-click events for this button; see the note above.)</span></div>`;
  }
  const rows = recipients.map((r) => `
    <tr>
      <td>${escapeHtml(r.mobile_number || '—')}</td>
      <td class="num">${fmtNum(r.button_taps)}</td>
      <td>${fmtDate(r.first_button_click)}</td>
      <td>${fmtDate(r.last_button_click)}</td>
    </tr>
  `).join('');

  const note = total > recipients.length
    ? `<div class="hint" style="margin-top:8px;">Showing first ${recipients.length.toLocaleString()} of ${total.toLocaleString()}. Use the "CSV"/"Excel" buttons on this row above for the complete list.</div>`
    : '';

  return `
    <div class="drill-wrap">
      <table>
        <thead><tr><th>Mobile</th><th class="num">Button taps</th><th>First tap</th><th>Last tap</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${note}
    </div>
  `;
}

document.getElementById('apply-filters').addEventListener('click', loadSummary);
document.getElementById('clear-filters').addEventListener('click', () => {
  fMobile.value = '';
  fButton.value = '';
  fStartDate.value = '';
  fEndDate.value = '';
  loadSummary();
});
[fMobile, fButton, fStartDate, fEndDate].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadSummary(); }
}));

loadSummary();
