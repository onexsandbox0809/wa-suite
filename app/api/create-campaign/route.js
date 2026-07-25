import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseClient';

function utcStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${date}_${time}`;
}

function buildButtonName(flowType) {
  // CTA -> L1_campaign_CTA_<UTC date_time>
  // QR  -> L2_campaign_QR_<UTC date_time>  (QR always forces a level-2 CTA message)
  const level = flowType === 'QR' ? 'L2' : 'L1';
  return `${level}_campaign_${flowType}_${utcStamp()}`;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const {
    campaign_name,
    flow_type,
    l1_media_url,
    l1_message_body,
    l1_cta_url,
    l1_cta_name,
    l2_media_url,
    l2_message_body,
    l2_cta_url,
    l2_cta_name,
    l12_button_bridge_name,
  } = body || {};

  const missing = [];
  if (!campaign_name) missing.push('campaign_name');
  if (!['CTA', 'QR'].includes(flow_type)) missing.push('flow_type');
  if (!l1_media_url) missing.push('l1_media_url');
  if (!l1_message_body) missing.push('l1_message_body');

  if (flow_type === 'CTA') {
    if (!l1_cta_url) missing.push('l1_cta_url');
    if (!l1_cta_name) missing.push('l1_cta_name');
  }
  if (flow_type === 'QR') {
    if (!l2_media_url) missing.push('l2_media_url');
    if (!l2_message_body) missing.push('l2_message_body');
    if (!l2_cta_url) missing.push('l2_cta_url');
    if (!l2_cta_name) missing.push('l2_cta_name');
    if (!l12_button_bridge_name) missing.push('l12_button_bridge_name');
  }

  if (missing.length) {
    return NextResponse.json({ error: `Missing required fields: ${missing.join(', ')}` }, { status: 400 });
  }

  const button_name = buildButtonName(flow_type);

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      campaign_name,
      button_name,
      flow_type,
      l1_media_url,
      l1_message_body,
      l1_cta_url: flow_type === 'CTA' ? l1_cta_url : null,
      l1_cta_name: flow_type === 'CTA' ? l1_cta_name : null,
      l2_media_url: flow_type === 'QR' ? l2_media_url : null,
      l2_message_body: flow_type === 'QR' ? l2_message_body : null,
      l2_cta_url: flow_type === 'QR' ? l2_cta_url : null,
      l2_cta_name: flow_type === 'QR' ? l2_cta_name : null,
      l12_button_bridge_name: flow_type === 'QR' ? l12_button_bridge_name : null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
