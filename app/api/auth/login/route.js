import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';
import { createSessionToken } from '../../../../lib/session';

const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const { email, password } = body || {};
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'SESSION_SECRET is not configured on the server' }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('verify_user_login', {
    p_email: email,
    p_password: password,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const user = data[0];
  const token = await createSessionToken(
    { email: user.email, exp: Date.now() + SEVEN_DAYS_MS },
    secret
  );

  const res = NextResponse.json({ ok: true, email: user.email });
  res.cookies.set('wa_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days, in seconds
  });
  return res;
}
