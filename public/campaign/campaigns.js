const tableBody = document.getElementById('table-body');
const emptyState = document.getElementById('empty-state');
const loadingState = document.getElementById('loading-state');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');

let currentPage = 1;
let totalCount = 0;

function pageSize() {
  return parseInt(document.getElementById('f_size').value, 10);
}

async function loadCampaigns() {
  loadingState.style.display = 'block';
  emptyState.style.display = 'none';
  tableBody.innerHTML = '';

  const params = new URLSearchParams({
    page: currentPage,
    pageSize: pageSize(),
  });
  const name = document.getElementById('f_name').value.trim();
  const from = document.getElementById('f_from').value;
  const to = document.getElementById('f_to').value;
  if (name) params.set('campaignName', name);
  if (from) params.set('fromDate', from);
  if (to) params.set('toDate', to);

  try {
    const res = await fetch(`/api/list-campaigns?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load campaigns');

    totalCount = data.total;
    renderRows(data.rows);
    renderPagination();
  } catch (err) {
    loadingState.textContent = `Error: ${err.message}`;
    return;
  } finally {
    loadingState.style.display = 'none';
  }
}

function renderRows(rows) {
  if (!rows.length) {
    emptyState.style.display = 'block';
    return;
  }
  const startIndex = (currentPage - 1) * pageSize();

  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const created = new Date(row.created_at);
    const createdStr = created.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const flowBadge = `<span class="badge ${row.flow_type === 'CTA' ? 'cta' : 'qr'}">${row.flow_type}</span>`;

    tr.innerHTML = `
      <td>${startIndex + i + 1}</td>
      <td>${escapeHtml(row.campaign_name)}</td>
      <td style="font-family: var(--mono); font-size: 12px;">${escapeHtml(row.button_name)} ${flowBadge}</td>
      <td>${createdStr}</td>
      <td class="row-actions">
        <button class="btn btn-outline-blue btn-sm" data-action="details" data-button="${escapeAttr(row.button_name)}">Show Details</button>
        <button class="btn btn-outline-rose btn-sm" data-action="clone" data-button="${escapeAttr(row.button_name)}">Clone Configuration</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize()));
  pageInfo.textContent = `Page ${currentPage} of ${totalPages} · ${totalCount} campaign(s)`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---------- Filters ----------
document.getElementById('apply-filters').addEventListener('click', () => {
  currentPage = 1;
  loadCampaigns();
});
document.getElementById('clear-filters').addEventListener('click', () => {
  document.getElementById('f_name').value = '';
  document.getElementById('f_from').value = '';
  document.getElementById('f_to').value = '';
  document.getElementById('f_size').value = '10';
  currentPage = 1;
  loadCampaigns();
});
document.getElementById('f_size').addEventListener('change', () => {
  currentPage = 1;
  loadCampaigns();
});
prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadCampaigns(); } });
nextBtn.addEventListener('click', () => { currentPage++; loadCampaigns(); });

// ---------- Row actions ----------
tableBody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const buttonName = btn.dataset.button;

  if (btn.dataset.action === 'clone') {
    window.location.href = `index.html?clone=${encodeURIComponent(buttonName)}`;
    return;
  }

  if (btn.dataset.action === 'details') {
    await openDetails(buttonName);
  }
});

async function openDetails(buttonName) {
  const modal = document.getElementById('details-modal');
  modal.classList.add('show');
  document.getElementById('modal-title').textContent = 'Loading…';

  try {
    const res = await fetch(`/api/campaign-details?button_name=${encodeURIComponent(buttonName)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load details');

    document.getElementById('modal-title').textContent = data.campaign_name;
    document.getElementById('m_campaign_name').value = data.campaign_name;
    document.getElementById('m_button_name').value = data.button_name;
    document.getElementById('m_flow_type').value = data.flow_type;
    document.getElementById('m_l1_media_url').value = data.l1_media_url || '';
    document.getElementById('m_l1_message_body').value = data.l1_message_body || '';
    document.getElementById('m_l1_cta_url').value = data.l1_cta_url || '';
    document.getElementById('m_created_at').value = data.created_at;

    const l2Wrap = document.getElementById('m_l2_wrap');
    if (data.flow_type === 'QR') {
      l2Wrap.style.display = 'block';
      document.getElementById('m_l2_media_url').value = data.l2_media_url || '';
      document.getElementById('m_l2_message_body').value = data.l2_message_body || '';
      document.getElementById('m_l2_cta_url').value = data.l2_cta_url || '';
    } else {
      l2Wrap.style.display = 'none';
    }
  } catch (err) {
    document.getElementById('modal-title').textContent = `Error: ${err.message}`;
  }
}

document.getElementById('close-modal').addEventListener('click', () => {
  document.getElementById('details-modal').classList.remove('show');
});
document.getElementById('details-modal').addEventListener('click', (e) => {
  if (e.target.id === 'details-modal') e.target.classList.remove('show');
});

// initial load
loadCampaigns();
