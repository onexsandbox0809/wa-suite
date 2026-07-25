import { NextResponse } from 'next/server';

// Ensures Node.js APIs (fetch/FormData with real network calls) behave as expected.
export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB, matches the GUI limit

export async function POST(request) {
  const apiKey = process.env.ONEXAURA_API_KEY;
  const phoneNumber = process.env.ONEXAURA_PHONE_NUMBER; // e.g. 919217090193
  if (!apiKey || !phoneNumber) {
    return NextResponse.json({ error: 'ONEXAURA_API_KEY / ONEXAURA_PHONE_NUMBER not configured' }, { status: 500 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not parse the uploaded file' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file received' }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 5 MB limit' }, { status: 400 });
  }

  try {
    const forwardForm = new FormData();
    forwardForm.append('phone_number', phoneNumber);
    forwardForm.append('file', file, file.name || 'upload');

    const upstream = await fetch('https://api.onexaura.com/wa/mediaupload', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        apikey: apiKey,
      },
      body: forwardForm,
    });

    const data = await upstream.json();
    if (!upstream.ok || data.status !== 'success') {
      return NextResponse.json(
        { error: data.message || 'Onexaura upload failed', raw: data },
        { status: upstream.status || 502 }
      );
    }

    return NextResponse.json(data); // { id, status, http_status, onextel_media_url }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
