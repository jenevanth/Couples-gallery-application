// supabase/functions/push-new-image-v1/index.ts (Edge Function)
// Updated to use HIGH priority, valid Android fields, and clean up UNREGISTERED tokens.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "server misconfigured" }, 500);
    }
    if (!FCM_PROJECT_ID || !FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY) {
      return json({ ok: false, error: "Missing FCM credentials" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const imageId = body?.image_id;
    const debugNotifySelf = !!body?.debug_notify_self;
    if (!imageId) return json({ ok: false, error: "image_id required" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Get image
    const { data: image, error: imgErr } = await supabase
      .from("images")
      .select("id, user_id, household_id, file_name, image_url, created_at")
      .eq("id", imageId)
      .single();
    if (imgErr || !image) return json({ ok: false, error: "image not found" }, 404);

    // 2) Recipients
    let recipientIds: string[] = [];
    const { data: members, error: memErr } = await supabase
      .from("household_members")
      .select("user_id")
      .eq("household_id", image.household_id);
    if (!memErr && members?.length) {
      recipientIds = members.map((m) => m.user_id);
    } else {
      const { data: allDevs, error: allErr } = await supabase
        .from("devices")
        .select("user_id");
      if (allErr) {
        return json({ ok: true, sent: 0, reason: "no recipients (fallback failed)" });
      }
      recipientIds = [...new Set((allDevs || []).map((d) => d.user_id))];
    }
    if (!debugNotifySelf) {
      recipientIds = recipientIds.filter((uid) => uid !== image.user_id);
    }
    if (!recipientIds.length) return json({ ok: true, sent: 0, reason: "no recipients" });

    // 3) Tokens
    const { data: tokens, error: tokErr } = await supabase
      .from("devices")
      .select("token, user_id")
      .in("user_id", recipientIds);
    if (tokErr) return json({ ok: false, error: "token fetch failed" }, 500);

    const registration_ids = (tokens || []).map((t) => t.token).filter(Boolean);
    if (!registration_ids.length) return json({ ok: true, sent: 0, reason: "no tokens" });

    // 4) FCM access token
    const accessToken = await getAccessToken(FCM_CLIENT_EMAIL!, FCM_PRIVATE_KEY!);

    // 5) Send one-by-one
    let sent = 0, failure = 0;
    const fcmResults: any[] = [];
    for (const token of registration_ids) {
      const payload = {
        message: {
          token,
          notification: {
            title: "New Photo Uploaded! 📸",
            body: image.file_name || "Check out the latest addition",
          },
          data: {
            type: "new_image",
            image_id: String(image.id),
            image_url: image.image_url,
            uploaded_by: image.user_id,
            deep_link: `yourapp://gallery/image/${image.id}`,
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
                  title: "New Photo Uploaded! 📸",
                  body: image.file_name || "Check out the latest addition",
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
            await supabase.from("devices").delete().eq("token", token);
          }
        }
        fcmResults.push({ token, status: fcmRes.status, resp: fcmJson });
      } catch (e) {
        failure++;
        fcmResults.push({ token, error: String(e) });
      }
    }

    return json({
      ok: true,
      sent,
      failure,
      ms: Date.now() - started,
      recipients: recipientIds,
      tokens: registration_ids,
      fcmResults,
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});


// import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// // Get secrets from environment
// const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
// const FCM_PROJECT_ID = Deno.env.get("FCM_PROJECT_ID");
// const FCM_CLIENT_EMAIL = Deno.env.get("FCM_CLIENT_EMAIL");
// const FCM_PRIVATE_KEY = Deno.env.get("FCM_PRIVATE_KEY");

// function json(data: unknown, status = 200) {
//   return new Response(JSON.stringify(data), {
//     status,
//     headers: { "Content-Type": "application/json" },
//   });
// }

// // Helper: Get Google OAuth2 access token for FCM HTTP v1
// async function getAccessToken(client_email: string, private_key: string) {
//   const now = Math.floor(Date.now() / 1000);
//   const header = { alg: "RS256", typ: "JWT" };
//   const payload = {
//     iss: client_email,
//     scope: "https://www.googleapis.com/auth/firebase.messaging",
//     aud: "https://oauth2.googleapis.com/token",
//     iat: now,
//     exp: now + 3600,
//   };
//   function base64url(input: string) {
//     return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
//   }
//   const enc = (obj: any) => base64url(JSON.stringify(obj));
//   const toSign = `${enc(header)}.${enc(payload)}`;

//   // Deno's crypto.subtle expects ArrayBuffer for private key, so decode PEM
//   function pemToArrayBuffer(pem: string) {
//     const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
//     const bin = atob(b64);
//     const buf = new Uint8Array(bin.length);
//     for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
//     return buf.buffer;
//   }
//   const keyBuf = pemToArrayBuffer(private_key);
//   const key = await crypto.subtle.importKey(
//     "pkcs8",
//     keyBuf,
//     { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
//     false,
//     ["sign"]
//   );
//   const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign));
//   const jwt = `${toSign}.${base64url(String.fromCharCode(...new Uint8Array(sig)))}`;

//   const res = await fetch("https://oauth2.googleapis.com/token", {
//     method: "POST",
//     headers: { "Content-Type": "application/x-www-form-urlencoded" },
//     body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
//   });
//   const json = await res.json();
//   if (!json.access_token) throw new Error("Failed to get FCM access token: " + JSON.stringify(json));
//   return json.access_token;
// }

// serve(async req => {
//   const started = Date.now();
//   try {
//     console.log('[fn] --- Function started ---');
//     if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
//       console.error('[fn] Missing SUPABASE_URL or SERVICE_ROLE_KEY');
//       return json({ ok: false, error: 'server misconfigured' }, 500);
//     }
//     if (!FCM_PROJECT_ID || !FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY) {
//       console.error('[fn] Missing FCM service account credentials');
//       return json({ ok: false, error: 'Missing FCM service account credentials' }, 500);
//     }
//     const body = await req.json().catch(() => ({}));
//     console.log('[fn] body:', body);

//     const imageId = body?.image_id;
//     const debugNotifySelf = !!body?.debug_notify_self;
//     if (!imageId) {
//       console.error('[fn] No image_id in body');
//       return json({ ok: false, error: 'image_id required' }, 400);
//     }
//     const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

//     // 1) Get the image row
//     const { data: image, error: imgErr } = await supabase
//       .from('images')
//       .select('id, user_id, household_id, file_name, image_url, created_at')
//       .eq('id', imageId)
//       .single();
//     console.log('[fn] Fetched image:', image, imgErr);

//     if (imgErr || !image) {
//       console.error('[fn] image fetch error:', imgErr, 'image:', image);
//       return json({ ok: false, error: 'image not found' }, 404);
//     }

//     // 2) Compute recipient user_ids
//     let recipientIds: string[] = [];
//     let usedHousehold = false;
//     try {
//       const { data: members, error: memErr } = await supabase
//         .from('household_members')
//         .select('user_id')
//         .eq('household_id', image.household_id);
//       if (memErr) {
//         console.error('[fn] household_members fetch error:', memErr);
//       }
//       if (!memErr && members?.length) {
//         usedHousehold = true;
//         recipientIds = members.map(m => m.user_id);
//       }
//       console.log('[fn] household_members:', members);
//     } catch (e) {
//       console.log('[fn] household_members lookup failed:', e);
//     }

//     if (!recipientIds.length) {
//       // fallback: all unique users from devices
//       const { data: allDevs, error: allErr } = await supabase
//         .from('devices')
//         .select('user_id');
//       if (allErr) {
//         console.error('[fn] fallback device users error:', allErr);
//         return json({
//           ok: true,
//           sent: 0,
//           reason: 'no recipients (fallback failed)',
//         });
//       }
//       recipientIds = [...new Set((allDevs || []).map(d => d.user_id))];
//       console.log('[fn] fallback recipientIds:', recipientIds);
//     }

//     // include/exclude uploader
//     if (!debugNotifySelf) {
//       recipientIds = recipientIds.filter(uid => uid !== image.user_id);
//       console.log('[fn] uploader excluded from recipients:', image.user_id);
//     } else {
//       console.log('[fn] uploader included in recipients:', image.user_id);
//     }

//     console.log('[fn] recipients:', {
//       count: recipientIds.length,
//       ids: recipientIds,
//       usedHousehold,
//       debugNotifySelf,
//     });

//     if (!recipientIds.length) {
//       console.warn('[fn] No recipientIds found');
//       return json({ ok: true, sent: 0, reason: 'no recipients' });
//     }

//     // 3) Fetch tokens
//     const { data: tokens, error: tokErr } = await supabase
//       .from('devices')
//       .select('token, user_id')
//       .in('user_id', recipientIds);

//     if (tokErr) {
//       console.error('[fn] token fetch error:', tokErr);
//       return json({ ok: false, error: 'token fetch failed' }, 500);
//     }

//     const registration_ids = (tokens || []).map(t => t.token).filter(Boolean);
//     console.log('[fn] token count:', registration_ids.length, 'tokens:', registration_ids);

//     if (!registration_ids.length) {
//       console.warn('[fn] No registration_ids found');
//       return json({ ok: true, sent: 0, reason: 'no tokens' });
//     }

//     // 4) Get FCM access token
//     let accessToken = "";
//     try {
//       accessToken = await getAccessToken(FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY);
//       console.log('[fn] Got FCM access token');
//     } catch (e) {
//       console.error('[fn] Failed to get FCM access token:', e);
//       return json({ ok: false, error: 'Failed to get FCM access token' }, 500);
//     }

//     // 5) Send notification to each device token (FCM v1 API does not support batch)
//     let sent = 0, failure = 0, fcmResults: any[] = [];
//     for (const token of registration_ids) {
//       const payload = {
//   message: {
//     token,
//     notification: {
//       title: 'New Photo Uploaded! 📸',
//       body: image.file_name || 'Check out the latest addition',
//       click_action: 'FLUTTER_NOTIFICATION_CLICK', // Important for React Native
//     },
//     data: {
//       type: 'new_image',
//       image_id: String(image.id),
//       image_url: image.image_url,
//       user_id: image.user_id,
//       uploaded_by: image.user_id,
//       show_in_foreground: 'true',
//       // Add any other data you need for deep linking
//       deep_link: `yourapp://gallery/image/${image.id}`,
//     },
//     android: {
//       priority: 'high',
//       notification: {
//         channel_id: 'default',
//         sound: 'default',
//         visibility: 'public',
//         notification_priority: 'PRIORITY_MAX',
//         // Force show even if app is in foreground
//         default_vibrate_timings: true,
//         default_light_settings: true,
//       },
//     },
//     apns: {
//       payload: {
//         aps: {
//           sound: 'default',
//           badge: 1,
//           // Important for iOS foreground behavior
//           'content-available': 1,
//           // Force show on iOS
//           alert: {
//             title: 'New Photo Uploaded! 📸',
//             body: image.file_name || 'Check out the latest addition',
//           },
//         },
//       },
//     },
//     webpush: {
//       notification: {
//         icon: 'https://your-app-icon.png',
//       },
//     },
//   },
//       };
      
//       try {
//         const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
//           method: "POST",
//           headers: {
//             "Authorization": `Bearer ${accessToken}`,
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify(payload),
//         });
//         const fcmJson = await fcmRes.json().catch(() => ({}));
//         if (fcmRes.ok) {
//           sent++;
//         } else {
//           failure++;
//         }
//         fcmResults.push({ token, status: fcmRes.status, resp: fcmJson });
//         console.log('[fn] FCM response:', { token, status: fcmRes.status, resp: fcmJson });
//       } catch (e) {
//         failure++;
//         fcmResults.push({ token, error: String(e) });
//         console.error('[fn] FCM send error:', token, e);
//       }
//     }

//     return json({
//       ok: true,
//       sent,
//       failure,
//       ms: Date.now() - started,
//       recipients: recipientIds,
//       tokens: registration_ids,
//       fcmResults,
//     });
//   } catch (e) {
//     console.error('[fn] exception:', e && (e.stack || e.message || e));
//     return json({ ok: false, error: String(e) }, 500);
//   }
// });





// import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
// import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// const SERVICE_ROLE_KEY =
//   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
// const FCM_SERVER_KEY = Deno.env.get("FCM_SERVER_KEY");

// function json(data: unknown, status = 200) {
//   return new Response(JSON.stringify(data), {
//     status,
//     headers: { "Content-Type": "application/json" },
//   });
// }

// serve(async req => {
//   const started = Date.now();
//   try {
//     console.log('[fn] --- Function started ---');
//     if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
//       console.error('[fn] Missing SUPABASE_URL or SERVICE_ROLE_KEY');
//       return json({ ok: false, error: 'server misconfigured' }, 500);
//     }
//     if (!FCM_SERVER_KEY) {
//       console.error('[fn] Missing FCM_SERVER_KEY');
//       return json({ ok: false, error: 'Missing FCM_SERVER_KEY' }, 500);
//     }
//     const body = await req.json().catch(() => ({}));
//     console.log('[fn] body:', body);

//     const imageId = body?.image_id;
//     const debugNotifySelf = !!body?.debug_notify_self;
//     if (!imageId) {
//       console.error('[fn] No image_id in body');
//       return json({ ok: false, error: 'image_id required' }, 400);
//     }

//     const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

//     // 1) Get the image row (need user_id, household_id, file_name, image_url)
//     const { data: image, error: imgErr } = await supabase
//       .from('images')
//       .select('id, user_id, household_id, file_name, image_url, created_at')
//       .eq('id', imageId)
//       .single();

//     if (imgErr || !image) {
//       console.error('[fn] image fetch error:', imgErr, 'image:', image);
//       return json({ ok: false, error: 'image not found' }, 404);
//     }
//     console.log('[fn] image:', image);

//     // 2) Compute recipient user_ids
//     let recipientIds: string[] = [];
//     let usedHousehold = false;
//     try {
//       const { data: members, error: memErr } = await supabase
//         .from('household_members')
//         .select('user_id')
//         .eq('household_id', image.household_id);
//       if (memErr) {
//         console.error('[fn] household_members fetch error:', memErr);
//       }
//       if (!memErr && members?.length) {
//         usedHousehold = true;
//         recipientIds = members.map(m => m.user_id);
//       }
//       console.log('[fn] household_members:', members);
//     } catch (e) {
//       console.log('[fn] household_members lookup failed:', e);
//     }

//     if (!recipientIds.length) {
//       // fallback: all unique users from devices
//       const { data: allDevs, error: allErr } = await supabase
//         .from('devices')
//         .select('user_id');
//       if (allErr) {
//         console.error('[fn] fallback device users error:', allErr);
//         return json({
//           ok: true,
//           sent: 0,
//           reason: 'no recipients (fallback failed)',
//         });
//       }
//       recipientIds = [...new Set((allDevs || []).map(d => d.user_id))];
//       console.log('[fn] fallback recipientIds:', recipientIds);
//     }

//     // include/exclude uploader
//     if (!debugNotifySelf) {
//       recipientIds = recipientIds.filter(uid => uid !== image.user_id);
//       console.log('[fn] uploader excluded from recipients:', image.user_id);
//     } else {
//       console.log('[fn] uploader included in recipients:', image.user_id);
//     }

//     console.log('[fn] recipients:', {
//       count: recipientIds.length,
//       ids: recipientIds,
//       usedHousehold,
//       debugNotifySelf,
//     });

//     if (!recipientIds.length) {
//       console.warn('[fn] No recipientIds found');
//       return json({ ok: true, sent: 0, reason: 'no recipients' });
//     }

//     // 3) Fetch tokens
//     const { data: tokens, error: tokErr } = await supabase
//       .from('devices')
//       .select('token, user_id')
//       .in('user_id', recipientIds);

//     if (tokErr) {
//       console.error('[fn] token fetch error:', tokErr);
//       return json({ ok: false, error: 'token fetch failed' }, 500);
//     }

//     const registration_ids = (tokens || []).map(t => t.token).filter(Boolean);
//     console.log('[fn] token count:', registration_ids.length, 'tokens:', registration_ids);

//     if (!registration_ids.length) {
//       console.warn('[fn] No registration_ids found');
//       return json({ ok: true, sent: 0, reason: 'no tokens' });
//     }

//     // 4) FCM Legacy HTTP
//     const payload = {
//       registration_ids,
//       priority: 'high',
//       notification: {
//         title: 'New item added',
//         body: image.file_name || 'Tap to view',
//         android_channel_id: 'default',
//       },
//       data: {
//         type: 'new_image',
//         image_id: String(image.id),
//         image_url: image.image_url,
//       },
//     };

//     console.log('[fn] FCM payload:', payload);

//     const fcmRes = await fetch('https://fcm.googleapis.com/fcm/send', {
//       method: 'POST',
//       headers: {
//         Authorization: `key=${FCM_SERVER_KEY}`,
//         'Content-Type': 'application/json',
//       },
//       body: JSON.stringify(payload),
//     });

//     const fcmJson = await fcmRes.json().catch(() => ({}));
//     console.log('[fn] FCM status:', fcmRes.status, 'resp:', fcmJson);

//     return json({
//       ok: true,
//       sent: fcmJson.success ?? 0,
//       failure: fcmJson.failure ?? 0,
//       ms: Date.now() - started,
//       recipients: recipientIds,
//       tokens: registration_ids,
//       fcmResp: fcmJson,
//     });
//   } catch (e) {
//     console.error('[fn] exception:', e);
//     return json({ ok: false, error: String(e) }, 500);
//   }
// });