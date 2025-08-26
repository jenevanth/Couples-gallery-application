// supabase/functions/push-new-image-v1/index.js
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Secrets (set via: supabase secrets set KEY=VALUE ...)
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');

const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID');
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL');
// Store your private key with literal "\n" sequences; we convert them here:
const FCM_PRIVATE_KEY_RAW = Deno.env.get('FCM_PRIVATE_KEY');
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

// Basic validation
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[push-new-image-v1] Missing SUPABASE_URL or SERVICE_ROLE_KEY');
}
if (!FCM_PROJECT_ID || !FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY_RAW) {
  console.error('[push-new-image-v1] Missing FCM_* secrets');
}

// Convert escaped newlines -> real newlines
const FCM_PRIVATE_KEY = (FCM_PRIVATE_KEY_RAW || '').replace(/\\n/g, '\n');

// Supabase service client
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Helpers
function pemToArrayBuffer(pem) {
  const lines = pem.trim().split('\n');
  const base64 = lines
    .filter(l => !l.includes('BEGIN') && !l.includes('END'))
    .join('');
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}
function toBase64Url(input) {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Mint OAuth token for FCM v1
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: FCM_CLIENT_EMAIL,
    scope: FCM_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = toBase64Url(JSON.stringify(header));
  const claimB64 = toBase64Url(JSON.stringify(claim));
  const unsigned = `${headerB64}.${claimB64}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(FCM_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const encoder = new TextEncoder();
  const sigBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    encoder.encode(unsigned),
  );
  const signatureB64 = toBase64Url(
    String.fromCharCode(...new Uint8Array(sigBuffer)),
  );
  const jwt = `${unsigned}.${signatureB64}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    console.error('[push-new-image-v1] OAuth token error:', json);
    throw new Error(`OAuth token error: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

serve(async req => {
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    console.log('[push-new-image-v1] request body:', body);
    const imageId = body?.image_id;
    if (!imageId) return json({ error: 'image_id required' }, 400);

    // 1) Fetch image context
    const { data: image, error: imgErr } = await supabase
      .from('images')
      .select('id, user_id, household_id, file_name')
      .eq('id', imageId)
      .single();

    if (imgErr || !image) {
      console.error('[push-new-image-v1] image fetch error:', imgErr);
      return json({ error: 'image not found' }, 404);
    }
    console.log('[push-new-image-v1] image:', image);

    // 2) Find recipients via household_members (exclude uploader)
    const { data: members, error: memErr } = await supabase
      .from('household_members')
      .select('user_id')
      .eq('household_id', image.household_id);

    if (memErr) {
      console.error('[push-new-image-v1] members fetch error:', memErr);
      return json({ error: 'members fetch error' }, 500);
    }

    const recipientIds = (members || [])
      .map(m => m.user_id)
      .filter(uid => uid !== image.user_id);

    console.log('[push-new-image-v1] recipients:', recipientIds);

    if (!recipientIds.length) {
      console.log('[push-new-image-v1] No recipients');
      return json({ ok: true, sent: 0, ms: Date.now() - started });
    }

    // 3) Fetch device tokens for those recipients
    const { data: devs, error: devErr } = await supabase
      .from('devices')
      .select('token, user_id')
      .in('user_id', recipientIds);

    if (devErr) {
      console.error('[push-new-image-v1] devices fetch error:', devErr);
      return json({ error: 'devices fetch error' }, 500);
    }

    const tokens = (devs || []).map(d => d.token).filter(Boolean);
    console.log('[push-new-image-v1] token count:', tokens.length);

    if (!tokens.length) {
      return json({
        ok: true,
        sent: 0,
        reason: 'no tokens',
        ms: Date.now() - started,
      });
    }

    // 4) Send via FCM HTTP v1 (OAuth)
    const accessToken = await getAccessToken();
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;

    let sent = 0;
    for (const token of tokens) {
      const payload = {
        message: {
          token,
          notification: {
            title: 'New photo',
            body: image.file_name
              ? `Added: ${image.file_name}`
              : 'A new photo was added',
          },
          data: {
            screen: 'Gallery',
            image_id: String(image.id),
          },
          android: { priority: 'HIGH' },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      };

      const res = await fetch(fcmUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      console.log('[push-new-image-v1] send ok?', res.ok, j);
      if (res.ok) sent++;
    }

    return json({ ok: true, sent, ms: Date.now() - started });
  } catch (e) {
    console.error('[push-new-image-v1] exception:', e);
    return json({ error: String(e) }, 500);
  }
});
