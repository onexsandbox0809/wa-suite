// ---------------- Shared state ----------------
const fMobile = document.getElementById('f_mobile');
const fButton = document.getElementById('f_button');
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

// Row-level Report buttons export the FULL dataset for that button.
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

// ---------------- Summary (paginated) ----------------
async function loadSummary() {
  summaryLoading.style.display = 'block';
  summaryEmpty.style.display = 'none';
  summaryBody.innerHTML = '';
  refreshExportLinks();

  const { mobile_number, button_name, start_date, end_date } = currentFilters();
  const params = new URLSearchParams({ page: String(summaryState.page), pageSize: String(summaryState.pageSize) });
  if (mobile_number) params.set('mobile_number', mobile_number);
  if (button_name) params.set('button_name', button_name);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);

  try {
    const res = await fetch(`/api/button-vs-url?${params.toString()}`);
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
    const lastActivity = [row.last_button_click, row.last_url_click].filter(Boolean).sort().pop();
    const tr = document.createElement('tr');
    tr.className = 'summary-row';
    tr.innerHTML = `
      <td style="font-family: var(--mono); font-size: 12px; cursor:pointer;" title="${escapeHtml(row.button_name)}">${escapeHtml(row.button_name)}</td>
      <td class="num">${fmtNum(row.total_button_clicks)}</td>
      <td class="num">${fmtNum(row.unique_button_clickers)}</td>
      <td class="num">${fmtNum(row.total_url_clicks)}</td>
      <td class="num">${fmtNum(row.unique_url_clickers)}</td>
      <td class="num"><span class="badge gap">${fmtNum(row.clicked_button_not_url)}</span></td>
      <td title="${escapeHtml(fmtDate(lastActivity))}">${fmtDate(lastActivity)}</td>
      <td class="action-cell">
        <button type="button" class="btn btn-outline-blue btn-xs" data-action="view">View</button>
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.button_name, 'csv')}" title="Download the full Mobile/Button Click/URL Click report (CSV) for this button">CSV</a>
        <a class="btn btn-neutral btn-xs" href="${buildDetailExportHref(row.button_name, 'xlsx')}" title="Download the full Mobile/Button Click/URL Click report (Excel, capped 150k) for this button">Excel</a>
      </td>
    `;
    tr.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
    const openHandler = () => openRecipientModal(row.button_name);
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
  fButton.value = '';
  fStartDate.value = '';
  fEndDate.value = '';
  summaryState.page = 1;
  loadSummary();
});
[fMobile, fButton, fStartDate, fEndDate].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); summaryState.page = 1; loadSummary(); }
}));

// ---------------- Recipient browser modal ----------------
const recipientModal = document.getElementById('recipient-modal');
const recipientBody = document.getElementById('recipient-body');
const recipientEmpty = document.getElementById('recipient-empty');
const recipientLoading = document.getElementById('recipient-loading');
const recipientSummary = document.getElementById('recipient-summary');
const recipientSearch = document.getElementById('recipient-search');
const recipientSort = document.getElementById('recipient-sort');
const toggleNotClicked = document.getElementById('toggle-not-clicked');
const toggleAll = document.getElementById('toggle-all');

let recipientState = { buttonName: null, page: 1, pageSize: 25, onlyNotClicked: true, search: '', sort: 'recent' };
let recipientSearchDebounce = null;

function openRecipientModal(buttonName) {
  recipientState = { buttonName, page: 1, pageSize: 25, onlyNotClicked: true, search: '', sort: 'recent' };
  recipientSearch.value = '';
  recipientSort.value = 'recent';
  setToggleUI();
  document.getElementById('recipient-modal-title').textContent = buttonName;
  recipientModal.classList.add('show');
  loadRecipients();
}

function setToggleUI() {
  toggleNotClicked.classList.toggle('active', recipientState.onlyNotClicked);
  toggleAll.classList.toggle('active', !recipientState.onlyNotClicked);
}

function buildRecipientExportHref(format) {
  const { start_date, end_date } = currentFilters();
  const params = new URLSearchParams({
    button_name: recipientState.buttonName,
    format,
    only_not_clicked: String(recipientState.onlyNotClicked),
    sort: recipientState.sort,
  });
  if (recipientState.search) params.set('search_mobile', recipientState.search);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);
  return `/api/export/button-vs-url-detail?${params.toString()}`;
}

async function loadRecipients() {
  recipientLoading.style.display = 'block';
  recipientEmpty.style.display = 'none';
  recipientBody.innerHTML = '';
  document.getElementById('recipient-export-csv').href = buildRecipientExportHref('csv');

  const { start_date, end_date } = currentFilters();
  const params = new URLSearchParams({
    button_name: recipientState.buttonName,
    page: String(recipientState.page),
    pageSize: String(recipientState.pageSize),
    only_not_clicked: String(recipientState.onlyNotClicked),
    sort: recipientState.sort,
  });
  if (recipientState.search) params.set('search_mobile', recipientState.search);
  if (start_date) params.set('start_date', start_date);
  if (end_date) params.set('end_date', end_date);

  try {
    const res = await fetch(`/api/button-vs-url-detail?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load recipients');
    renderRecipients(data.recipients || []);
    renderRecipientPager(data);
  } catch (err) {
    recipientBody.innerHTML = '';
    recipientEmpty.style.display = 'block';
    recipientEmpty.textContent = `Error: ${err.message}`;
  } finally {
    recipientLoading.style.display = 'none';
  }
}

function renderRecipients(recipients) {
  if (!recipients.length) {
    recipientEmpty.style.display = 'block';
    recipientEmpty.textContent = recipientState.onlyNotClicked
      ? 'No one matches "not clicked" for this view — nice conversion, or try "All recipients".'
      : 'No recipients match this search.';
    recipientSummary.textContent = '';
    return;
  }
  recipientSummary.textContent = '';
  recipientBody.innerHTML = recipients.map((r) => `
    <tr>
      <td>${escapeHtml(r.mobile_number || '—')}</td>
      <td>${fmtDate(r.button_click)}</td>
      <td>${r.url_click ? fmtDate(r.url_click) : '<span class="badge gap">Not clicked</span>'}</td>
    </tr>
  `).join('');
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

toggleNotClicked.addEventListener('click', () => {
  recipientState.onlyNotClicked = true;
  recipientState.page = 1;
  setToggleUI();
  loadRecipients();
});
toggleAll.addEventListener('click', () => {
  recipientState.onlyNotClicked = false;
  recipientState.page = 1;
  setToggleUI();
  loadRecipients();
});
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

// initial load
loadSummary();
