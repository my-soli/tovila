// Simulates an inbound WhatsApp message by POSTing a payload shaped exactly
// like Meta's real webhook body to your own local /webhook endpoint — this
// exercises the real webhook → agent → DB code path, not a shortcut.
//
// Usage:
//   node scripts/simulate-message.js "<to-seller-number>" "<from-customer-number>" "<message text>"
//
// Example:
//   node scripts/simulate-message.js "254700000001" "254701338496" "Do you have the floral dress in size M?"
//
// <to> must match a seller's whatsapp_number in the sellers table (run
// "npm run seed" to create demo sellers). <from> is any made-up customer
// number — reuse the same one across calls to build up a conversation.
require("dotenv").config();
const crypto = require("crypto");
const prisma = require("../src/db/client");
const { getSellerByWhatsappNumber } = require("../src/services/sellers");

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
                  id: `wamid.SIMULATED${Date.now()}`,
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

async function main() {
  const [, , to, from, ...rest] = process.argv;
  const text = rest.join(" ");

  if (!to || !from || !text) {
    console.error(
      'Usage: node scripts/simulate-message.js "<to-seller-number>" "<from-customer-number>" "<message text>"'
    );
    process.exitCode = 1;
    return;
  }

  const seller = await getSellerByWhatsappNumber(to);
  if (!seller) {
    console.error(
      `No seller found with whatsapp_number "${to}". Run "npm run seed" or check the sellers table.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Simulating message to "${seller.name}" (${to}) from ${from}:`);
  console.log(`  "${text}"`);

  const startedAt = new Date();
  const port = process.env.PORT || 3000;
  const url = `http://localhost:${port}/webhook`;

  const rawBody = JSON.stringify(buildWebhookPayload({ to, from, text }));
  const signature = signPayload(rawBody);
  const headers = { "Content-Type": "application/json" };
  if (signature) {
    headers["X-Hub-Signature-256"] = signature;
  } else {
    console.log(
      "(WHATSAPP_APP_SECRET not set — sending unsigned; make sure VERIFY_WEBHOOK_SIGNATURE=false in .env for local testing)"
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: rawBody,
  });

  if (!res.ok) {
    console.error(`Webhook responded with ${res.status} — is the server running ("npm run dev")?`);
    process.exitCode = 1;
    return;
  }

  console.log("Webhook accepted the message, waiting for the agent's reply...");

  const reply = await waitForReply({ sellerId: seller.id, customerPhone: from, after: startedAt });

  if (reply) {
    console.log(`\n${seller.name} bot reply:\n  "${reply.content}"\n`);
  } else {
    console.warn(
      "Timed out waiting for a reply — check the server logs (the terminal running \"npm run dev\") for errors."
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
