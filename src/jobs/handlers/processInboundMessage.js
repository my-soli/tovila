const {
  getOrCreateConversation,
  getRecentMessages,
  getMessagesBefore,
  hasReplyAfter,
  saveMessage,
  findMessageBySourceId,
} = require("../../services/conversation");
const { getSellerByWhatsappNumber } = require("../../services/sellers");
const { generateReply } = require("../../agent/core");
const { sendWhatsAppMessage } = require("../../whatsapp/client");

/**
 * Processes one raw WhatsApp webhook payload (job.payload). This is the same
 * body Meta POSTs to /webhook — the webhook route just enqueues it and
 * returns 200 immediately; this is where the actual work happens, off the
 * request/response cycle, with retries on failure via the jobs queue.
 */
async function processInboundMessage(body) {
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

    await handleIncomingMessage(seller, from, text, message.id);
  }
}

/**
 * Meta's own message id (wamid) doubles as an idempotency key, since a
 * retried job (after a transient failure downstream) or a genuine webhook
 * redelivery from Meta must not send the customer a duplicate reply. If this
 * exact message was already fully handled (already has an agent reply after
 * it), skip entirely. If it was partially handled (saved but never got a
 * reply, e.g. Claude failed last attempt), resume from there instead of
 * re-saving it.
 */
async function handleIncomingMessage(seller, from, text, sourceMessageId) {
  const existing = sourceMessageId ? await findMessageBySourceId(sourceMessageId) : null;

  if (existing) {
    const alreadyReplied = await hasReplyAfter(existing.conversationId, existing.timestamp);
    if (alreadyReplied) {
      console.log(`Skipping already-processed message ${sourceMessageId}`);
      return;
    }
  }

  const conversation = existing
    ? { id: existing.conversationId }
    : await getOrCreateConversation(seller.id, from);

  // Fetch prior context BEFORE saving this message, so we don't double it up.
  const history = existing
    ? await getMessagesBefore(conversation.id, existing.timestamp, 20)
    : await getRecentMessages(conversation.id, 20);

  if (!existing) {
    await saveMessage(conversation.id, "customer", text, { sourceMessageId });
  }

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

module.exports = { processInboundMessage };
