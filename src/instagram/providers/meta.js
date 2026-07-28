const GRAPH_API_VERSION = "v21.0";

/**
 * Sends a plain-text Instagram DM via Meta's Send API — the same
 * long-stable Messenger-Platform shape (recipient/message) that Instagram
 * messaging reuses. Unlike src/whatsapp/providers/meta.js (one global
 * WHATSAPP_ACCESS_TOKEN for the whole app), the access token is per-seller
 * here — each seller links their own Instagram Professional account/Page,
 * so there's no single app-wide token to read from env vars.
 */
async function sendInstagramMessage(accessToken, to, text) {
  if (!accessToken) {
    throw new Error("Seller has no instagramAccessToken set — Instagram isn't connected yet.");
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(accessToken)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: to },
      message: { text },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Instagram send failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

/**
 * Instagram's webhook payload is Messenger-Platform-shaped
 * (entry[].messaging[], not WhatsApp Cloud API's entry[].changes[].value) —
 * normalized here into the same internal envelope processInboundMessage.js
 * already reads for WhatsApp/Twilio, so the job handler has one shape to
 * deal with regardless of channel. `metadata.display_phone_number` is
 * reused as a generic "which account received this" slot (an Instagram
 * account ID here, not actually a phone number).
 */
function normalizeInstagramPayload(body) {
  const entry = body?.entry?.[0];
  const messagingEvent = entry?.messaging?.[0];

  if (!messagingEvent?.message) {
    return { entry: [{ changes: [{ value: { metadata: {}, messages: [] } }] }] };
  }

  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: messagingEvent.recipient?.id },
              messages: [
                {
                  from: messagingEvent.sender?.id,
                  id: messagingEvent.message.mid,
                  type: "text",
                  text: { body: messagingEvent.message.text || "" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

module.exports = { sendInstagramMessage, normalizeInstagramPayload };
