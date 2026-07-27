const WHATSAPP_API_VERSION = "v21.0";

/** POSTs a message body to the Cloud API's /messages endpoint, shared by text and template sends. */
async function postToMeta(body) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !token) {
    throw new Error(
      "WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not set — check your .env"
    );
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

/**
 * Sends a plain-text WhatsApp message via the Meta Business Cloud API.
 * `to` must be a phone number in international format with no leading "+"
 * (this is the same format WhatsApp sends back in `message.from`).
 *
 * Only valid within 24h of the customer's last inbound message — see
 * src/services/messagingWindow.js and src/whatsapp/templates.js for the
 * template-message path required outside that window.
 */
async function sendMetaMessage(to, text) {
  return postToMeta({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  });
}

module.exports = { sendMetaMessage, postToMeta };
