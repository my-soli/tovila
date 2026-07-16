// Shared helpers for simulating inbound WhatsApp messages against the local
// /webhook endpoint — used by both scripts/simulate-message.js (single
// message, interactive) and scripts/test-conversations.js (scripted batch).
const crypto = require("crypto");
const prisma = require("../../src/db/client");

/**
 * When WHATSAPP_APP_SECRET is set, sign the request the same way Meta does
 * — this exercises the real signature-verification code path (see
 * src/middleware/verifySignature.js) instead of relying on
 * VERIFY_WEBHOOK_SIGNATURE=false to bypass it.
 */
function signPayload(rawBody) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return null;
  return "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

function buildWebhookPayload({ to, from, text }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "SIMULATED_WABA_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: to,
                phone_number_id: "SIMULATED_PHONE_NUMBER_ID",
              },
              contacts: [{ profile: { name: "Simulated Customer" }, wa_id: from }],
              messages: [
                {
                  from,
                  id: `wamid.SIMULATED${Date.now()}${Math.random().toString(16).slice(2)}`,
                  timestamp,
                  text: { body: text },
                  type: "text",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

async function waitForReply({ sellerId, customerPhone, after }, { timeoutMs = 20000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const conversation = await prisma.conversation.findFirst({
      where: { sellerId, customerPhone },
    });

    if (conversation) {
      const message = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          sender: "agent",
          timestamp: { gt: after },
        },
        orderBy: { timestamp: "desc" },
      });
      if (message) return message;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

/** Posts one simulated inbound message to the local webhook and waits for the agent's reply. */
async function sendSimulatedMessage({ to, from, text, seller }) {
  const startedAt = new Date();
  const port = process.env.PORT || 3000;
  const url = `http://localhost:${port}/webhook`;

  const rawBody = JSON.stringify(buildWebhookPayload({ to, from, text }));
  const signature = signPayload(rawBody);
  const headers = { "Content-Type": "application/json" };
  if (signature) headers["X-Hub-Signature-256"] = signature;

  const res = await fetch(url, { method: "POST", headers, body: rawBody });

  if (!res.ok) {
    throw new Error(`Webhook responded with ${res.status} — is the server running ("npm run dev")?`);
  }

  return waitForReply({ sellerId: seller.id, customerPhone: from, after: startedAt });
}

module.exports = { buildWebhookPayload, signPayload, waitForReply, sendSimulatedMessage };
