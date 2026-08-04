// ---------------- Shared state ----------------
const fMobile = document.getElementById('f_mobile');
const fCampaignButton = document.getElementById('f_campaign_button');
const fStartDate = document.getElementById('f_start_date');
const fEndDate = document.getElementById('f_end_date');

const summaryBody = document.getElementById('summary-body');
const summaryEmpty = document.getElementById('summary-empty');
const summaryLoading = document.getElementById('summary-loading');
const summaryPager = document.getElementById('summary-pager');
const summaryPagerInfo = document.getElementById('summary-pager-info');

const exportCsvLink = document.getElementById('export-csv');
const exportXlsxLink = document.getElementById('export-xlsx');

let summaryState = { page: 1, pageSize: 25 };

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

function buildSummaryExportHref(format) {
  const { mobile, campaign_button_name, start_date, end_date } = currentFilters();
  const params = new URLSearchParams({ format });
  if (mobile) params.set('mobile', mobile);
  if (campaign_button_name) params.set('campaign_button_name', campaign_button_name);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);
  return `/api/export/summary?${params.toString()}`;
}

// Row-level Report buttons export the FULL dataset for that button.
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

// ---------------- Summary (paginated) ----------------
async function loadSummary() {
  summaryLoading.style.display = 'block';
  summaryEmpty.style.display = 'none';
  summaryBody.innerHTML = '';
  refreshExportLinks();

  const { mobile, campaign_button_name, start_date, end_date } = currentFilters();
  const params = new URLSearchParams({ page: String(summaryState.page), pageSize: String(summaryState.pageSize) });
  if (mobile) params.set('mobile', mobile);
  if (campaign_button_name) params.set('campaign_button_name', campaign_button_name);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);

  try {
    const res = await fetch(`/api/click-summary?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load summary');
    renderSummary(data.summary || []);
    renderSummaryPager(data);
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
    tr.innerHTML = `
      <td style="font-family: var(--mono); font-size: 12px; cursor:pointer;" title="${escapeHtml(row.campaign_button_name)}">${escapeHtml(row.campaign_button_name)}</td>
      <td class="num">${fmtNum(row.total_links)}</td>
      <td class="num"><span class="badge cta">${fmtNum(row.total_clicks)}</span></td>
      <td class="num">${fmtNum(row.unique_mobiles)}</td>
      <td title="${escapeHtml(fmtDate(row.last_click))}">${fmtDate(row.last_click)}</td>
      <td class="action-cell">
        <button type="button" class="btn btn-outline-blue btn-xs" data-action="view">View</button>
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.campaign_button_name, 'csv')}" title="Download the full per-click report (CSV) for this button">CSV</a>
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.campaign_button_name, 'xlsx')}" title="Download the full per-click report (Excel, capped 150k) for this button">Excel</a>
      </td>
    `;
    tr.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
    const openHandler = () => openRecipientModal(row.campaign_button_name);
    tr.querySelector('td').addEventListener('click', openHandler);
    tr.querySelector('button[data-action="view"]').addEventListener('click', (e) => { e.stopPropagation(); openHandler(); });
    summaryBody.appendChild(tr);
  });
}

function renderSummaryPager(data) {
  if (!data.total) {
    summaryPager.style.display = 'none';
    return;
  }
  summaryPager.style.display = 'flex';
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  summaryPagerInfo.textContent = `${from}–${to} of ${fmtNum(data.total)} campaign button${data.total === 1 ? '' : 's'}`;
  document.getElementById('summary-prev').disabled = data.page <= 1;
  document.getElementById('summary-next').disabled = data.page >= data.totalPages;
}

document.getElementById('summary-prev').addEventListener('click', () => { summaryState.page--; loadSummary(); });
document.getElementById('summary-next').addEventListener('click', () => { summaryState.page++; loadSummary(); });

document.getElementById('apply-filters').addEventListener('click', () => { summaryState.page = 1; loadSummary(); });
document.getElementById('clear-filters').addEventListener('click', () => {
  fMobile.value = '';
  fCampaignButton.value = '';
  fStartDate.value = '';
  fEndDate.value = '';
  summaryState.page = 1;
  loadSummary();
});
[fMobile, fCampaignButton, fStartDate, fEndDate].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); summaryState.page = 1; loadSummary(); }
}));

// ---------------- Recipient browser modal ----------------
const recipientModal = document.getElementById('recipient-modal');
const recipientBody = document.getElementById('recipient-body');
const recipientEmpty = document.getElementById('recipient-empty');
const recipientLoading = document.getElementById('recipient-loading');
const recipientSearch = document.getElementById('recipient-search');
const recipientSort = document.getElementById('recipient-sort');

let recipientState = { buttonName: null, page: 1, pageSize: 25, search: '', sort: 'recent' };
let recipientSearchDebounce = null;

function openRecipientModal(buttonName) {
  recipientState = { buttonName, page: 1, pageSize: 25, search: '', sort: 'recent' };
  recipientSearch.value = '';
  recipientSort.value = 'recent';
  document.getElementById('recipient-modal-title').textContent = buttonName;
  recipientModal.classList.add('show');
  loadRecipients();
}

function buildRecipientExportHref(format) {
  const { start_date, end_date } = currentFilters();
  const params = new URLSearchParams({
    campaign_button_name: recipientState.buttonName,
    exact: 'true',
    format,
  });
  if (recipientState.search) params.set('mobile', recipientState.search);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);
  return `/api/export/campaign-detail?${params.toString()}`;
}

async function loadRecipients() {
  recipientLoading.style.display = 'block';
  recipientEmpty.style.display = 'none';
  recipientBody.innerHTML = '';
  document.getElementById('recipient-export-csv').href = buildRecipientExportHref('csv');

  const { start_date, end_date } = currentFilters();
  const params = new URLSearchParams({
    campaign_button_name: recipientState.buttonName,
    exact: 'true',
    page: String(recipientState.page),
    pageSize: String(recipientState.pageSize),
    sort: recipientState.sort,
  });
  if (recipientState.search) params.set('mobile', recipientState.search);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);

  try {
    const res = await fetch(`/api/links?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load recipients');
    renderRecipients(data.links || []);
    renderRecipientPager(data);
  } catch (err) {
    recipientEmpty.style.display = 'block';
    recipientEmpty.textContent = `Error: ${err.message}`;
  } finally {
    recipientLoading.style.display = 'none';
  }
}

function renderRecipients(links) {
  if (!links.length) {
    recipientEmpty.style.display = 'block';
    recipientEmpty.textContent = 'No recipients match this view.';
    return;
  }
  recipientBody.innerHTML = links.map((l) => {
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
  recipientBody.querySelectorAll('button[data-action="details"]').forEach((btn) => {
    btn.addEventListener('click', () => openDetailsModal(btn.dataset.code, btn.dataset.mobile));
  });
}

function renderRecipientPager(data) {
  const info = document.getElementById('recipient-pager-info');
  if (!data.total) {
    info.textContent = '';
    document.getElementById('recipient-prev').disabled = true;
    document.getElementById('recipient-next').disabled = true;
    return;
  }
  const from = (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  info.textContent = `${from}–${to} of ${fmtNum(data.total)}`;
  document.getElementById('recipient-prev').disabled = data.page <= 1;
  document.getElementById('recipient-next').disabled = data.page >= data.totalPages;
}

recipientSearch.addEventListener('input', () => {
  clearTimeout(recipientSearchDebounce);
  recipientSearchDebounce = setTimeout(() => {
    recipientState.search = recipientSearch.value.trim();
    recipientState.page = 1;
    loadRecipients();
  }, 350);
});
recipientSort.addEventListener('change', () => {
  recipientState.sort = recipientSort.value;
  recipientState.page = 1;
  loadRecipients();
});
document.getElementById('recipient-prev').addEventListener('click', () => { recipientState.page--; loadRecipients(); });
document.getElementById('recipient-next').addEventListener('click', () => { recipientState.page++; loadRecipients(); });

document.getElementById('close-recipient-modal').addEventListener('click', () => {
  recipientModal.classList.remove('show');
});
recipientModal.addEventListener('click', (e) => {
  if (e.target.id === 'recipient-modal') e.target.classList.remove('show');
});

// ---------------- "Show Details" modal: paginated raw click log (nested) --
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

// initial load
loadSummary();
