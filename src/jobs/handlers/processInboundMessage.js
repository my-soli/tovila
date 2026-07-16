const {
  getOrCreateConversation,
  getRecentMessages,
  getMessagesBefore,
  hasReplyAfter,
  saveMessage,
  findMessageBySourceId,
} = require("../../services/conversation");
const { getSellerByWhatsappNumber } = require("../../services/sellers");
const { isRateLimited, MAX_MESSAGES_PER_HOUR } = require("../../services/rateLimit");
const { generateReply } = require("../../agent/core");
const { sendWhatsAppMessage } = require("../../whatsapp/client");

// Meta message types that aren't plain text. Full understanding is out of
// scope for now — the agent just replies honestly instead of ignoring or
// crashing, and the media type/id are logged so it's visible in the
// dashboard conversation thread.
const MEDIA_LABELS = {
  image: "an image",
  video: "a video",
  audio: "an audio message",
  document: "a document",
  sticker: "a sticker",
  location: "a location",
  contacts: "a contact card",
};

const MEDIA_REPLIES = {
  image: "I can see you've sent an image — could you describe what you're looking for in text for now? I'm not able to view images just yet.",
  video: "Thanks for the video — I can't watch videos yet, could you describe what you need in text?",
  audio: "I can see you've sent a voice note — I can't listen to audio yet, could you type out your question instead?",
  document: "I can see you've sent a document — could you describe what you need in text for now?",
  sticker: "Thanks for the sticker! How can I help you today?",
  location: "Thanks for sharing your location — could you also confirm the area/estate name in text so I can note it correctly?",
  contacts: "Thanks for sharing that contact — how can I help you today?",
};

const DEFAULT_MEDIA_REPLY =
  "I can see you've sent something I'm not able to read yet — could you describe what you need in text?";

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
    const from = message.from; // sender's WhatsApp number, e.g. "2547XXXXXXXX"
    if (!from) continue;

    // Cheap DB count, checked before any Claude call — protects against a
    // single abusive number (regardless of which seller) running up costs.
    if (await isRateLimited(from)) {
      await recordRateLimitedMessage(seller, message);
      continue;
    }

    if (message.type === "text") {
      const text = message.text?.body?.trim();
      if (!text) continue;

      await handleIncomingMessage(seller, from, text, message.id);
    } else {
      await handleMediaMessage(seller, message);
    }
  }
}

/**
 * A number over the rate limit still gets its message recorded (for the
 * record / dashboard visibility) but no reply is generated — dropping the
 * expensive part (Claude calls, WhatsApp sends) rather than crashing or
 * silently vanishing the message entirely.
 */
async function recordRateLimitedMessage(seller, message) {
  if (message.id && (await findMessageBySourceId(message.id))) return;

  const from = message.from;
  const type = message.type;
  const content =
    type === "text"
      ? message.text?.body?.trim() || ""
      : `[Customer sent ${MEDIA_LABELS[type] || "something"}]`;

  const conversation = await getOrCreateConversation(seller.id, from);
  await saveMessage(conversation.id, "customer", content, {
    sourceMessageId: message.id,
    mediaType: type !== "text" ? type : null,
    mediaId: type !== "text" ? message[type]?.id || null : null,
  });

  console.warn(
    `Rate limit exceeded for ${from} (> ${MAX_MESSAGES_PER_HOUR} messages/hour) — message saved but no reply generated.`
  );
}

/** Sends a WhatsApp reply, degrading gracefully (log only) while credentials are placeholders. */
async function sendReplySafely(to, reply) {
  try {
    await sendWhatsAppMessage(to, reply);
  } catch (err) {
    console.warn(`WhatsApp send failed (${err.message})`);
    console.log(`Would have sent to WhatsApp: ${reply}`);
  }
}

/**
 * Non-text messages (images, audio, documents, ...) get a sensible canned
 * reply instead of being ignored or crashing the agent — full media
 * understanding is a later phase. The media type/id are recorded so the
 * dashboard can show what was sent.
 */
async function handleMediaMessage(seller, message) {
  const from = message.from;
  const type = message.type;

  if (message.id && (await findMessageBySourceId(message.id))) {
    console.log(`Skipping already-processed message ${message.id}`);
    return;
  }

  const mediaId = message[type]?.id || null;
  const label = MEDIA_LABELS[type] || "something";
  const content = `[Customer sent ${label}]`;
  const reply = MEDIA_REPLIES[type] || DEFAULT_MEDIA_REPLY;

  const conversation = await getOrCreateConversation(seller.id, from);

  await saveMessage(conversation.id, "customer", content, {
    sourceMessageId: message.id,
    mediaType: type,
    mediaId,
  });
  await saveMessage(conversation.id, "agent", reply);

  await sendReplySafely(from, reply);
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

  await sendReplySafely(from, reply);
}

module.exports = { processInboundMessage };
