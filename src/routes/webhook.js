const express = require("express");
const {
  getOrCreateConversation,
  getRecentMessages,
  saveMessage,
} = require("../services/conversation");
const { getSellerByWhatsappNumber } = require("../services/sellers");
const { generateReply } = require("../agent/core");
const { sendWhatsAppMessage } = require("../whatsapp/client");

const router = express.Router();

// GET /webhook — Meta's one-time webhook verification challenge.
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified by Meta.");
    return res.status(200).send(challenge);
  }

  console.warn("Webhook verification failed.");
  return res.sendStatus(403);
});

// POST /webhook — incoming WhatsApp messages / status updates.
// Meta expects a 2xx response within a few seconds or it will retry (and you
// get duplicate deliveries) — so we ack immediately and process afterwards.
router.post("/", (req, res) => {
  res.sendStatus(200);

  processWebhookPayload(req.body).catch((err) => {
    console.error("Error processing webhook payload:", err);
  });
});

async function processWebhookPayload(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const messages = value?.messages;

  if (!messages || messages.length === 0) {
    // Delivery/read status callbacks and other non-message events land here.
    return;
  }

  // The number the customer messaged — i.e. the seller's WhatsApp business
  // number — determines whose catalog/FAQs the agent should use.
  const to = value?.metadata?.display_phone_number;
  const seller = to ? await getSellerByWhatsappNumber(to) : null;

  if (!seller) {
    console.warn(
      `No seller configured for WhatsApp number "${to}" — ignoring message(s). Check the sellers table / run "npm run seed".`
    );
    return;
  }

  for (const message of messages) {
    if (message.type !== "text") {
      // MVP handles text only; extend here for images/audio/etc. later.
      continue;
    }

    const from = message.from; // sender's WhatsApp number, e.g. "2547XXXXXXXX"
    const text = message.text?.body?.trim();
    if (!text) continue;

    try {
      await handleIncomingMessage(seller, from, text);
    } catch (err) {
      console.error(`Failed to handle message from ${from}:`, err);
    }
  }
}

async function handleIncomingMessage(seller, from, text) {
  const conversation = await getOrCreateConversation(seller.id, from);

  // Fetch prior context BEFORE saving this message, so we don't double it up.
  const history = await getRecentMessages(conversation.id, 20);

  await saveMessage(conversation.id, "customer", text);

  const reply = await generateReply({
    seller,
    conversationId: conversation.id,
    history,
    incomingText: text,
  });

  await saveMessage(conversation.id, "agent", reply);

  // WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID are still placeholders until Meta's
  // verification is sorted — don't let a failed send crash message handling
  // or lose the reply we already saved to the conversation.
  try {
    await sendWhatsAppMessage(from, reply);
  } catch (err) {
    console.warn(`WhatsApp send failed (${err.message})`);
    console.log(`Would have sent to WhatsApp: ${reply}`);
  }
}

module.exports = router;
