// supabase/functions/push-new-message/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Get request body
    const { message_id, text } = await req.json()
    
    if (!message_id) {
      throw new Error('message_id is required')
    }

    console.log('Processing push notification for message:', message_id)

    // Get message details with sender info
    const { data: message, error: messageError } = await supabaseClient
      .from('messages')
      .select(`
        *,
        sender:profiles!messages_sender_id_fkey(
          id,
          display_name,
          avatar_url,
          current_profile
        )
      `)
      .eq('id', message_id)
      .single()

    if (messageError) {
      console.error('Error fetching message:', messageError)
      throw messageError
    }

    if (!message) {
      throw new Error('Message not found')
    }

    // Get recipient (other household member)
    const { data: recipients, error: recipientsError } = await supabaseClient
      .from('profiles')
      .select('id')
      .eq('household_id', message.household_id)
      .neq('id', message.sender_id)

    if (recipientsError) {
      console.error('Error fetching recipients:', recipientsError)
      throw recipientsError
    }

    if (!recipients || recipients.length === 0) {
      console.log('No recipients found for household:', message.household_id)
      return new Response(
        JSON.stringify({ success: false, message: 'No recipients found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get FCM tokens for recipients
    const recipientIds = recipients.map(r => r.id)
    const { data: devices, error: devicesError } = await supabaseClient
      .from('devices')
      .select('token')
      .in('user_id', recipientIds)

    if (devicesError) {
      console.error('Error fetching devices:', devicesError)
      throw devicesError
    }

    if (!devices || devices.length === 0) {
      console.log('No devices found for recipients:', recipientIds)
      return new Response(
        JSON.stringify({ success: false, message: 'No devices registered' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Prepare notification
    const senderName = message.sender?.display_name || 'Your partner'
    const senderProfile = message.sender?.current_profile || 'boyfriend'
    const emoji = senderProfile === 'boyfriend' ? '💙' : '💕'
    
    const notification = {
      title: `${senderName} ${emoji}`,
      body: text || message.text || 'Sent you a message',
    }

    const data = {
      type: 'new_message',
      message_id: message.id,
      household_id: message.household_id,
      sender_id: message.sender_id,
      text: message.text,
      created_at: message.created_at,
    }

    // Send to FCM
    const fcmServerKey = Deno.env.get('FCM_SERVER_KEY')
    if (!fcmServerKey) {
      throw new Error('FCM_SERVER_KEY not configured')
    }

    const tokens = devices.map(d => d.token).filter(Boolean)
    console.log(`Sending to ${tokens.length} devices`)

    const fcmResponse = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${fcmServerKey}`,
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: {
          ...notification,
          sound: 'default',
          badge: 1,
          android_channel_id: 'boyfriend-needs-channel',
        },
        data,
        priority: 'high',
      }),
    })

    const fcmResult = await fcmResponse.json()
    console.log('FCM Response:', fcmResult)

    return new Response(
      JSON.stringify({ 
        success: true, 
        sent_to: tokens.length,
        fcm_result: fcmResult 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in push-new-message:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})