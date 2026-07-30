const summaryBody = document.getElementById('summary-body');
const summaryEmpty = document.getElementById('summary-empty');
const summaryLoading = document.getElementById('summary-loading');

const fMobile = document.getElementById('f_mobile');
const fCampaignButton = document.getElementById('f_campaign_button');
const fStartDate = document.getElementById('f_start_date');
const fEndDate = document.getElementById('f_end_date');

const exportCsvLink = document.getElementById('export-csv');
const exportXlsxLink = document.getElementById('export-xlsx');

const SUMMARY_COLSPAN = 7;

function escapeHtml(s) {
  return (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
function fmtNum(n) { return (n ?? 0).toLocaleString(); }

function currentFilters() {
  return {
    mobile: fMobile.value.trim(),
    campaign_button_name: fCampaignButton.value.trim(),
    start_date: fStartDate.value,
    end_date: fEndDate.value,
  };
}

// Top-of-page export buttons -> SUMMARY report (matches the table on screen)
function buildSummaryExportHref(format) {
  const { mobile, campaign_button_name, start_date, end_date } = currentFilters();
  const params = new URLSearchParams({ format });
  if (mobile) params.set('mobile', mobile);
  if (campaign_button_name) params.set('campaign_button_name', campaign_button_name);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);
  return `/api/export/summary?${params.toString()}`;
}

// Per-row Report buttons -> full detail report for that exact campaign button
function buildDetailExportHref(buttonName, format) {
  const { start_date, end_date } = currentFilters();
  const params = new URLSearchParams({ campaign_button_name: buttonName, format });
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);
  return `/api/export/campaign-detail?${params.toString()}`;
}

function refreshExportLinks() {
  exportCsvLink.href = buildSummaryExportHref('csv');
  exportXlsxLink.href = buildSummaryExportHref('xlsx');
}

// ---------------- Summary (grouped by campaign_button_name) ----------------
async function loadSummary() {
  summaryLoading.style.display = 'block';
  summaryEmpty.style.display = 'none';
  summaryBody.innerHTML = '';
  refreshExportLinks();

  const { mobile, campaign_button_name, start_date, end_date } = currentFilters();
  const params = new URLSearchParams();
  if (mobile) params.set('mobile', mobile);
  if (campaign_button_name) params.set('campaign_button_name', campaign_button_name);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);

  try {
    const res = await fetch(`/api/click-summary?${params.toString()}`);
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
    const tr = document.createElement('tr');
    tr.className = 'summary-row';
    tr.dataset.button = row.campaign_button_name;
    tr.innerHTML = `
      <td><span class="chevron">▶</span></td>
      <td style="font-family: var(--mono); font-size: 12px;" title="${escapeHtml(row.campaign_button_name)}">${escapeHtml(row.campaign_button_name)}</td>
      <td class="num">${fmtNum(row.total_links)}</td>
      <td class="num"><span class="badge cta">${fmtNum(row.total_clicks)}</span></td>
      <td class="num">${fmtNum(row.unique_mobiles)}</td>
      <td title="${escapeHtml(fmtDate(row.last_click))}">${fmtDate(row.last_click)}</td>
      <td class="report-cell">
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.campaign_button_name, 'csv')}" title="Download detail report (CSV) for this campaign button">CSV</a>
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.campaign_button_name, 'xlsx')}" title="Download detail report (Excel, capped 50k) for this campaign button">Excel</a>
      </td>
    `;
    tr.querySelectorAll('.report-cell a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
    tr.addEventListener('click', () => toggleDrilldown(row.campaign_button_name, tr));
    summaryBody.appendChild(tr);
  });
}

// ---------------- Drill-down: per-recipient link table for one button ----
async function toggleDrilldown(buttonName, summaryTr) {
  const existing = document.getElementById(`drill-${cssId(buttonName)}`);
  const chevron = summaryTr.querySelector('.chevron');

  if (existing) {
    existing.remove();
    chevron.classList.remove('open');
    return;
  }

  // Close any other open drill-down first (keep the UI simple / fast)
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
    const params = new URLSearchParams({
      campaign_button_name: buttonName,
      exact: 'true',
      page: '1',
      pageSize: '50',
    });
    if (start_date) params.set('start_date', start_date);
    if (end_date) params.set('end_date', end_date);
    const res = await fetch(`/api/links?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load recipients');
    td.innerHTML = renderDrilldownTable(data.links || [], data.total || 0, buttonName);
    wireDetailButtons(td);
  } catch (err) {
    td.innerHTML = `<div class="drill-wrap"><span style="color:#b91c1c;">Error: ${escapeHtml(err.message)}</span></div>`;
  }
}

function cssId(s) { return (s || '').replace(/[^a-zA-Z0-9_-]/g, '_'); }

function renderDrilldownTable(links, total, buttonName) {
  if (!links.length) {
    return `<div class="drill-wrap"><span class="muted">No recipients found.</span></div>`;
  }
  const rows = links.map((l) => {
    const shortUrl = `${window.location.origin}/${l.code}`;
    return `
      <tr>
        <td title="${escapeHtml(l.mobile_number || '')}">${escapeHtml(l.mobile_number || '—')}</td>
        <td><a href="${escapeHtml(shortUrl)}" target="_blank" rel="noreferrer" title="${escapeHtml(shortUrl)}">${escapeHtml(shortUrl.replace(/^https?:\/\//, ''))}</a></td>
        <td title="${escapeHtml(l.long_url)}">${escapeHtml(l.long_url)}</td>
        <td class="num">${fmtNum(l.total_clicks)}</td>
        <td class="num">${fmtNum(l.unique_clicks)}</td>
        <td title="${escapeHtml(fmtDate(l.last_clicked_at))}">${fmtDate(l.last_clicked_at)}</td>
        <td title="${escapeHtml(fmtDate(l.created_at))}">${fmtDate(l.created_at)}</td>
        <td><button class="btn btn-outline-blue btn-sm" data-action="details" data-code="${escapeHtml(l.code)}" data-mobile="${escapeHtml(l.mobile_number || '')}">Show Details</button></td>
      </tr>
    `;
  }).join('');

  const note = total > links.length
    ? `<div class="hint" style="margin-top:8px;">Showing first ${links.length.toLocaleString()} of ${total.toLocaleString()} recipients. Use the "CSV"/"Excel" buttons on this row above for the complete list.</div>`
    : '';

  return `
    <div class="drill-wrap">
      <table class="drill-table">
        <colgroup>
          <col class="c-mobile"><col class="c-short"><col class="c-dest"><col class="c-num"><col class="c-num"><col class="c-date"><col class="c-date"><col class="c-action">
        </colgroup>
        <thead>
          <tr>
            <th>Mobile</th><th>Short link</th><th>Destination</th>
            <th class="num">Clicks</th><th class="num">Unique</th><th>Last click</th><th>Created</th><th>Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${note}
    </div>
  `;
}

function wireDetailButtons(scopeEl) {
  scopeEl.querySelectorAll('button[data-action="details"]').forEach((btn) => {
    btn.addEventListener('click', () => openDetailsModal(btn.dataset.code, btn.dataset.mobile));
  });
}

// ---------------- "Show Details" modal: paginated raw click log ----------
let modalState = { code: null, page: 1, pageSize: 50 };

async function openDetailsModal(code, mobile) {
  const modal = document.getElementById('details-modal');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const pager = document.getElementById('modal-pager');

  modalState = { code, page: 1, pageSize: 50 };
  title.textContent = mobile ? `Clicks for ${mobile}` : 'Click details';
  body.innerHTML = '<p class="loading">Loading…</p>';
  pager.innerHTML = '';
  modal.classList.add('show');

  await loadModalPage();
}

async function loadModalPage() {
  const body = document.getElementById('modal-body');
  const pager = document.getElementById('modal-pager');

  try {
    const params = new URLSearchParams({
      code: modalState.code,
      page: String(modalState.page),
      pageSize: String(modalState.pageSize),
    });
    const res = await fetch(`/api/link-clicks?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load click details');

    if (!data.clicks.length) {
      body.innerHTML = '<p class="loading">No clicks yet.</p>';
      pager.innerHTML = '';
      return;
    }

    const rows = data.clicks.map((c) => `
      <tr>
        <td>${fmtDate(c.clicked_at)}</td>
        <td>${escapeHtml(c.ip || '—')}</td>
        <td>${escapeHtml([c.city, c.country].filter(Boolean).join(', ') || '—')}</td>
        <td title="${escapeHtml(c.referrer || '')}">${escapeHtml(c.referrer || '—')}</td>
        <td title="${escapeHtml(c.user_agent || '')}">${escapeHtml(c.user_agent || '—')}</td>
      </tr>
    `).join('');

    body.innerHTML = `
      <table>
        <thead><tr><th>When</th><th>IP</th><th>Location</th><th>Referrer</th><th>Device</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    pager.innerHTML = `
      <span>Page ${data.page} of ${data.totalPages} · ${fmtNum(data.total)} total click${data.total === 1 ? '' : 's'}</span>
      <button class="btn btn-neutral btn-sm" id="modal-prev" ${data.page <= 1 ? 'disabled' : ''}>Prev</button>
      <button class="btn btn-neutral btn-sm" id="modal-next" ${data.page >= data.totalPages ? 'disabled' : ''}>Next</button>
    `;
    const prevBtn = document.getElementById('modal-prev');
    const nextBtn = document.getElementById('modal-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { modalState.page--; loadModalPage(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { modalState.page++; loadModalPage(); });
  } catch (err) {
    body.innerHTML = `<p style="color:#b91c1c;">Error: ${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('details-modal').classList.remove('show');
});
document.getElementById('details-modal').addEventListener('click', (e) => {
  if (e.target.id === 'details-modal') e.target.classList.remove('show');
});

// ---------------- Filters ----------------
document.getElementById('apply-filters').addEventListener('click', loadSummary);
document.getElementById('clear-filters').addEventListener('click', () => {
  fMobile.value = '';
  fCampaignButton.value = '';
  fStartDate.value = '';
  fEndDate.value = '';
  loadSummary();
});
[fMobile, fCampaignButton, fStartDate, fEndDate].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadSummary(); }
}));

// initial load
loadSummary();
