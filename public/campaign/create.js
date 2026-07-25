const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'mp4', 'mov', 'webm'];

const form = document.getElementById('campaign-form');
const saveBtn = document.getElementById('save-btn');
const generateBtn = document.getElementById('generate-btn');
const formMsg = document.getElementById('form-msg');
const resultBox = document.getElementById('result-box');
const resultButtonName = document.getElementById('result-button-name');

const optCta = document.getElementById('opt-cta');
const optQr = document.getElementById('opt-qr');
const l1CtaFields = document.getElementById('l1-cta-fields');
const qrCallout = document.getElementById('qr-callout');
const l2Panel = document.getElementById('l2-panel');

let lastSavedCampaignName = null; // used by "Generate campaign button name"
let lastSavedButtonName = null;

// ---------- Radio toggle: CTA vs QR ----------
form.querySelectorAll('input[name="flow_type"]').forEach(radio => {
  radio.addEventListener('change', () => {
    optCta.classList.toggle('selected', optCta.querySelector('input').checked);
    optQr.classList.toggle('selected', optQr.querySelector('input').checked);

    const isQr = optQr.querySelector('input').checked;
    l1CtaFields.style.display = isQr ? 'none' : 'block';
    qrCallout.style.display = isQr ? 'block' : 'none';
    l2Panel.style.display = isQr ? 'block' : 'none';

    document.getElementById('l1_cta_url').required = !isQr;
    document.getElementById('l1_cta_name').required = !isQr;
    document.getElementById('l2_file').required = isQr;
    document.getElementById('l12_button_bridge_name').required = isQr;
    document.getElementById('l2_message_body').required = isQr;
    document.getElementById('l2_cta_name').required = isQr;
    document.getElementById('l2_cta_url').required = isQr;
  });
});

// ---------- File upload handling (click-to-browse + drag & drop) ----------
function setupFileInput(fileInputId, statusId, hiddenUrlId, dropZoneId, fileNameId) {
  const fileInput = document.getElementById(fileInputId);
  const status = document.getElementById(statusId);
  const hiddenUrl = document.getElementById(hiddenUrlId);
  const dropZone = document.getElementById(dropZoneId);
  const fileNameEl = document.getElementById(fileNameId);

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  fileInput.addEventListener('change', async () => {
    hiddenUrl.value = '';
    status.className = 'file-status';
    fileNameEl.textContent = '';
    const file = fileInput.files[0];
    if (!file) return;

    fileNameEl.textContent = file.name;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      status.textContent = `Unsupported file type: .${ext}`;
      status.className = 'file-status err';
      fileInput.value = '';
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      status.textContent = `File is ${(file.size / (1024 * 1024)).toFixed(2)} MB — max allowed is 5 MB.`;
      status.className = 'file-status err';
      fileInput.value = '';
      return;
    }

    status.textContent = 'Uploading…';
    status.className = 'file-status';

    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload-media', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.error || 'Upload failed');
      }
      hiddenUrl.value = data.onextel_media_url;
      status.textContent = `Uploaded ✓  ${data.onextel_media_url}`;
      status.className = 'file-status ok';
    } catch (err) {
      status.textContent = `Upload error: ${err.message}`;
      status.className = 'file-status err';
      fileInput.value = '';
    }
  });
}

setupFileInput('l1_file', 'l1_file_status', 'l1_media_url', 'l1_drop_zone', 'l1_file_name');
setupFileInput('l2_file', 'l2_file_status', 'l2_media_url', 'l2_drop_zone', 'l2_file_name');

// ---------- Save campaign ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formMsg.textContent = '';
  formMsg.className = 'msg';
  resultBox.classList.remove('show');
  generateBtn.disabled = true;

  const flowTypeInput = form.querySelector('input[name="flow_type"]:checked');
  if (!flowTypeInput) {
    formMsg.textContent = 'Select whether Level 1 uses a Call to Action or a Quick Reply button.';
    formMsg.className = 'msg error';
    return;
  }
  const flowType = flowTypeInput.value;

  const payload = {
    campaign_name: document.getElementById('campaign_name').value.trim(),
    flow_type: flowType,
    l1_media_url: document.getElementById('l1_media_url').value,
    l1_message_body: document.getElementById('l1_message_body').value.trim(),
    l1_cta_url: flowType === 'CTA' ? document.getElementById('l1_cta_url').value.trim() : null,
    l1_cta_name: flowType === 'CTA' ? document.getElementById('l1_cta_name').value.trim() : null,
    l2_media_url: flowType === 'QR' ? document.getElementById('l2_media_url').value : null,
    l12_button_bridge_name: flowType === 'QR' ? document.getElementById('l12_button_bridge_name').value.trim() : null,
    l2_message_body: flowType === 'QR' ? document.getElementById('l2_message_body').value.trim() : null,
    l2_cta_name: flowType === 'QR' ? document.getElementById('l2_cta_name').value.trim() : null,
    l2_cta_url: flowType === 'QR' ? document.getElementById('l2_cta_url').value.trim() : null,
  };

  // Client-side mandatory checks (server re-validates too)
  const missing = [];
  if (!payload.campaign_name) missing.push('Campaign name');
  if (!payload.l1_media_url) missing.push('Level 1 creative');
  if (!payload.l1_message_body) missing.push('Level 1 message body');
  if (flowType === 'CTA') {
    if (!payload.l1_cta_url) missing.push('Level 1 call to action URL');
    if (!payload.l1_cta_name) missing.push('Level 1 CTA button label');
  }
  if (flowType === 'QR') {
    if (!payload.l2_media_url) missing.push('Level 2 creative');
    if (!payload.l12_button_bridge_name) missing.push('Quick Reply button label');
    if (!payload.l2_message_body) missing.push('Level 2 message body');
    if (!payload.l2_cta_name) missing.push('Level 2 CTA button label');
    if (!payload.l2_cta_url) missing.push('Level 2 call to action URL');
  }
  if (missing.length) {
    formMsg.textContent = `Missing required fields: ${missing.join(', ')}`;
    formMsg.className = 'msg error';
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    const res = await fetch('/api/create-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save campaign');

    lastSavedCampaignName = data.campaign_name;
    lastSavedButtonName = data.button_name;

    formMsg.textContent = 'Campaign saved.';
    formMsg.className = 'msg success';
    generateBtn.disabled = false;
  } catch (err) {
    formMsg.textContent = `Error: ${err.message}`;
    formMsg.className = 'msg error';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save campaign details';
  }
});

// ---------- Generate / reveal campaign button name ----------
generateBtn.addEventListener('click', async () => {
  if (lastSavedButtonName) {
    resultButtonName.textContent = lastSavedButtonName;
    resultBox.classList.add('show');
    return;
  }
  // Fallback: fetch the latest saved button name for this campaign_name from the server
  try {
    const res = await fetch(`/api/campaign-details?campaign_name=${encodeURIComponent(lastSavedCampaignName || '')}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not fetch button name');
    resultButtonName.textContent = data.button_name;
    resultBox.classList.add('show');
  } catch (err) {
    formMsg.textContent = `Error: ${err.message}`;
    formMsg.className = 'msg error';
  }
});

// ---------- Clone support: /index.html?clone=<button_name> ----------
(async function initClone() {
  const params = new URLSearchParams(window.location.search);
  const cloneSource = params.get('clone');
  if (!cloneSource) return;

  document.getElementById('page-title').textContent = 'Clone Campaign';
  document.getElementById('page-subtitle').textContent =
    `Prefilled from ${cloneSource}. Nothing is overwritten — saving creates a brand-new campaign.`;

  try {
    const res = await fetch(`/api/campaign-details?button_name=${encodeURIComponent(cloneSource)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load source campaign');

    document.getElementById('campaign_name').value = `${data.campaign_name}_copy`;
    document.getElementById('l1_message_body').value = data.l1_message_body || '';
    document.getElementById('l1_media_url').value = data.l1_media_url || '';
    if (data.l1_media_url) {
      document.getElementById('l1_file_status').textContent = `Existing file kept: ${data.l1_media_url}`;
      document.getElementById('l1_file_status').className = 'file-status ok';
      document.getElementById('l1_file').required = false;
    }

    const radio = data.flow_type === 'QR' ? optQr.querySelector('input') : optCta.querySelector('input');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));

    if (data.flow_type === 'CTA') {
      document.getElementById('l1_cta_url').value = data.l1_cta_url || '';
      document.getElementById('l1_cta_name').value = data.l1_cta_name || '';
    } else {
      document.getElementById('l2_message_body').value = data.l2_message_body || '';
      document.getElementById('l2_media_url').value = data.l2_media_url || '';
      document.getElementById('l12_button_bridge_name').value = data.l12_button_bridge_name || '';
      document.getElementById('l2_cta_name').value = data.l2_cta_name || '';
      document.getElementById('l2_cta_url').value = data.l2_cta_url || '';
      if (data.l2_media_url) {
        document.getElementById('l2_file_status').textContent = `Existing file kept: ${data.l2_media_url}`;
        document.getElementById('l2_file_status').className = 'file-status ok';
        document.getElementById('l2_file').required = false;
      }
    }
  } catch (err) {
    formMsg.textContent = `Could not load clone source: ${err.message}`;
    formMsg.className = 'msg error';
  }
})();
