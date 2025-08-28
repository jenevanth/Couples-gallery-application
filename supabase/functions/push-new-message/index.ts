// supabase/functions/push-new-message/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Env secrets
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID");
const FCM_CLIENT_EMAIL = Deno.env.get("FCM_CLIENT_EMAIL");
const FCM_PRIVATE_KEY = Deno.env.get("FCM_PRIVATE_KEY");

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// OAuth2 token for FCM HTTP v1
async function getAccessToken(client_email: string, private_key: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  function base64url(input: string) {
    return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const enc = (obj: any) => base64url(JSON.stringify(obj));
  const toSign = `${enc(header)}.${enc(payload)}`;

  function pemToArrayBuffer(pem: string) {
    const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  const keyBuf = pemToArrayBuffer(private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(toSign),
  );
  const jwt = `${toSign}.${base64url(String.fromCharCode(...new Uint8Array(sig)))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) {
    throw new Error("Failed to get FCM access token: " + JSON.stringify(j));
  }
  return j.access_token;
}

serve(async (req) => {
  const started = Date.now();
  console.log("[fn-msg] --- push-new-message started ---");

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("[fn-msg] Missing SUPABASE_URL or SERVICE_ROLE_KEY");
      return json({ ok: false, error: "server misconfigured" }, 500);
    }
    if (!FCM_PROJECT_ID || !FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY) {
      console.error("[fn-msg] Missing FCM credentials");
      return json({ ok: false, error: "Missing FCM credentials" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    console.log("[fn-msg] body:", body);

    const messageId = body?.message_id;
    const debugNotifySelf = !!body?.debug_notify_self;

    if (!messageId) {
      console.error("[fn-msg] No message_id in body");
      return json({ ok: false, error: "message_id required" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Fetch message
    const { data: message, error: msgErr } = await supabase
      .from("messages")
      .select("id, sender_id, household_id, text, created_at")
      .eq("id", messageId)
      .single();

    console.log("[fn-msg] fetched message:", message, "err:", msgErr);
    if (msgErr || !message) {
      return json({ ok: false, error: "message not found" }, 404);
    }

    // Helper: format notification body
    const sanitizeText = (t?: string) => {
      const s = (t || "").trim();
      if (!s) return "New message";
      return s.length > 100 ? s.slice(0, 100) + "…" : s;
    };
    const notifTitle = "New message 💬";
    const notifBody = sanitizeText(message.text);

    // 2) Recipients (household members or fallback to all device users)
    let recipientIds: string[] = [];
    let usedHousehold = false;

    try {
      const { data: members, error: memErr } = await supabase
        .from("household_members")
        .select("user_id")
        .eq("household_id", message.household_id);

      if (!memErr && members?.length) {
        usedHousehold = true;
        recipientIds = members.map((m) => m.user_id);
      } else {
        console.warn("[fn-msg] household fallback path, memErr:", memErr);
        const { data: allDevs, error: allErr } = await supabase
          .from("devices")
          .select("user_id");
        if (allErr) {
          console.error("[fn-msg] fallback device users error:", allErr);
          return json({ ok: true, sent: 0, reason: "no recipients (fallback failed)" });
        }
        recipientIds = [...new Set((allDevs || []).map((d) => d.user_id))];
      }
    } catch (e) {
      console.error("[fn-msg] household lookup exception:", e);
    }

    // exclude sender unless debugNotifySelf
    if (!debugNotifySelf) {
      recipientIds = recipientIds.filter((uid) => uid !== message.sender_id);
    }
    // unique
    recipientIds = [...new Set(recipientIds)];

    console.log("[fn-msg] recipients:", {
      count: recipientIds.length,
      ids: recipientIds,
      usedHousehold,
      debugNotifySelf,
    });

    if (!recipientIds.length) {
      return json({ ok: true, sent: 0, reason: "no recipients" });
    }

    // 3) Tokens
    const { data: tokens, error: tokErr } = await supabase
      .from("devices")
      .select("token, user_id")
      .in("user_id", recipientIds);

    if (tokErr) {
      console.error("[fn-msg] token fetch error:", tokErr);
      return json({ ok: false, error: "token fetch failed" }, 500);
    }

    const registration_ids = (tokens || []).map((t) => t.token).filter(Boolean);
    console.log("[fn-msg] token count:", registration_ids.length, "tokens:", registration_ids);

    if (!registration_ids.length) {
      return json({ ok: true, sent: 0, reason: "no tokens" });
    }

    // 4) FCM Access Token
    let accessToken = "";
    try {
      accessToken = await getAccessToken(FCM_CLIENT_EMAIL!, FCM_PRIVATE_KEY!);
      console.log("[fn-msg] got FCM access token");
    } catch (e) {
      console.error("[fn-msg] FCM access token error:", e);
      return json({ ok: false, error: "fcm oauth failed" }, 500);
    }

    // 5) Send notifications one-by-one
    let sent = 0,
      failure = 0;
    const fcmResults: any[] = [];

    for (const token of registration_ids) {
      const payload = {
        message: {
          token,
          notification: {
            title: notifTitle,
            body: notifBody,
          },
          data: {
            type: "chat_message",
            message_id: String(message.id),
            household_id: String(message.household_id || ""),
            sender_id: String(message.sender_id),
            text: message.text || "",
            deep_link: `yourapp://chat/${message.household_id || ""}`,
          },
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "default",
              sound: "default",
              visibility: "PUBLIC",
              default_vibrate_timings: true,
              default_light_settings: true,
            },
          },
          apns: {
            headers: {
              "apns-push-type": "alert",
              "apns-priority": "10",
            },
            payload: {
              aps: {
                sound: "default",
                badge: 1,
                alert: {
                  title: notifTitle,
                  body: notifBody,
                },
              },
            },
          },
        },
      };

      try {
        const fcmRes = await fetch(
          `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        const fcmJson = await fcmRes.json().catch(() => ({}));
        if (fcmRes.ok) {
          sent++;
        } else {
          failure++;
          const errCode = fcmJson?.error?.details?.[0]?.errorCode;
          if (errCode === "UNREGISTERED") {
            // cleanup stale token
            await supabase.from("devices").delete().eq("token", token);
            console.warn("[fn-msg] removed UNREGISTERED token:", token);
          }
        }
        fcmResults.push({ token, status: fcmRes.status, resp: fcmJson });
        console.log("[fn-msg] FCM response:", { token, status: fcmRes.status });
      } catch (e) {
        failure++;
        fcmResults.push({ token, error: String(e) });
        console.error("[fn-msg] FCM send exception:", token, e);
      }
    }

    const out = {
      ok: true,
      sent,
      failure,
      ms: Date.now() - started,
      recipients: recipientIds,
      tokens: registration_ids,
      fcmResults,
    };
    console.log("[fn-msg] DONE:", out);
    return json(out);
  } catch (e) {
    console.error("[fn-msg] exception:", e && (e.stack || e.message || e));
    return json({ ok: false, error: String(e) }, 500);
  }
});




// // supabase/functions/push-new-message/index.ts
// import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// const corsHeaders = {
//   'Access-Control-Allow-Origin': '*',
//   'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
// }

// serve(async (req) => {
//   // Handle CORS preflight
//   if (req.method === 'OPTIONS') {
//     return new Response('ok', { headers: corsHeaders })
//   }

//   try {
//     const supabaseClient = createClient(
//       Deno.env.get('SUPABASE_URL') ?? '',
//       Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
//       {
//         auth: {
//           autoRefreshToken: false,
//           persistSession: false,
//         },
//       }
//     )

//     // Get request body
//     const { message_id, text } = await req.json()
    
//     if (!message_id) {
//       throw new Error('message_id is required')
//     }

//     console.log('Processing push notification for message:', message_id)

//     // Get message details with sender info
//     const { data: message, error: messageError } = await supabaseClient
//       .from('messages')
//       .select(`
//         *,
//         sender:profiles!messages_sender_id_fkey(
//           id,
//           display_name,
//           avatar_url,
//           current_profile
//         )
//       `)
//       .eq('id', message_id)
//       .single()

//     if (messageError) {
//       console.error('Error fetching message:', messageError)
//       throw messageError
//     }

//     if (!message) {
//       throw new Error('Message not found')
//     }

//     // Get recipient (other household member)
//     const { data: recipients, error: recipientsError } = await supabaseClient
//       .from('profiles')
//       .select('id')
//       .eq('household_id', message.household_id)
//       .neq('id', message.sender_id)

//     if (recipientsError) {
//       console.error('Error fetching recipients:', recipientsError)
//       throw recipientsError
//     }

//     if (!recipients || recipients.length === 0) {
//       console.log('No recipients found for household:', message.household_id)
//       return new Response(
//         JSON.stringify({ success: false, message: 'No recipients found' }),
//         { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
//       )
//     }

//     // Get FCM tokens for recipients
//     const recipientIds = recipients.map(r => r.id)
//     const { data: devices, error: devicesError } = await supabaseClient
//       .from('devices')
//       .select('token')
//       .in('user_id', recipientIds)

//     if (devicesError) {
//       console.error('Error fetching devices:', devicesError)
//       throw devicesError
//     }

//     if (!devices || devices.length === 0) {
//       console.log('No devices found for recipients:', recipientIds)
//       return new Response(
//         JSON.stringify({ success: false, message: 'No devices registered' }),
//         { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
//       )
//     }

//     // Prepare notification
//     const senderName = message.sender?.display_name || 'Your partner'
//     const senderProfile = message.sender?.current_profile || 'boyfriend'
//     const emoji = senderProfile === 'boyfriend' ? '💙' : '💕'
    
//     const notification = {
//       title: `${senderName} ${emoji}`,
//       body: text || message.text || 'Sent you a message',
//     }

//     const data = {
//       type: 'new_message',
//       message_id: message.id,
//       household_id: message.household_id,
//       sender_id: message.sender_id,
//       text: message.text,
//       created_at: message.created_at,
//     }

//     // Send to FCM
//     const fcmServerKey = Deno.env.get('FCM_SERVER_KEY')
//     if (!fcmServerKey) {
//       throw new Error('FCM_SERVER_KEY not configured')
//     }

//     const tokens = devices.map(d => d.token).filter(Boolean)
//     console.log(`Sending to ${tokens.length} devices`)

//     const fcmResponse = await fetch('https://fcm.googleapis.com/fcm/send', {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': `key=${fcmServerKey}`,
//       },
//       body: JSON.stringify({
//         registration_ids: tokens,
//         notification: {
//           ...notification,
//           sound: 'default',
//           badge: 1,
//           android_channel_id: 'boyfriend-needs-channel',
//         },
//         data,
//         priority: 'high',
//       }),
//     })

//     const fcmResult = await fcmResponse.json()
//     console.log('FCM Response:', fcmResult)

//     return new Response(
//       JSON.stringify({ 
//         success: true, 
//         sent_to: tokens.length,
//         fcm_result: fcmResult 
//       }),
//       { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
//     )

//   } catch (error) {
//     console.error('Error in push-new-message:', error)
//     return new Response(
//       JSON.stringify({ error: error.message }),
//       { 
//         status: 400,
//         headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
//       }
//     )
//   }
// })