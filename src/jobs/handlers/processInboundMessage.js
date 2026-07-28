const {
  getOrCreateConversation,
  getConversationById,
  setConversationStatus,
  getRecentMessages,
  getMessagesBefore,
  hasReplyAfter,
  saveMessage,
  findMessageBySourceId,
} = require("../../services/conversation");
const { getSellerByWhatsappNumber, getSellerByInstagramAccountId } = require("../../services/sellers");
const { isRateLimited, MAX_MESSAGES_PER_HOUR } = require("../../services/rateLimit");
const { notifyNeedsAttention } = require("../../services/notifications");
const { generateReply } = require("../../agent/core");
const { sendWhatsAppMessage } = require("../../whatsapp/client");
const { sendInstagramMessage } = require("../../instagram/providers/meta");

/** Resolves which seller a channel's recipient identifier belongs to — a phone number for WhatsApp, an Instagram account ID for Instagram. */
async function resolveSellerByChannel(channel, recipientId) {
  if (!recipientId) return null;
  return channel === "instagram"
    ? getSellerByInstagramAccountId(recipientId)
    : getSellerByWhatsappNumber(recipientId);
}

/** Sends a reply on whichever channel the conversation is on. */
async function sendChannelMessage(channel, seller, to, text) {
  if (channel === "instagram") {
    return sendInstagramMessage(seller.instagramAccessToken, to, text);
  }
  return sendWhatsAppMessage(to, text);
}

const NEEDS_ATTENTION_HOLDING_REPLY =
  "Thanks for the extra info — the shop owner is already looking into this and will get back to you shortly.";

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
 * Processes one raw inbound webhook payload (job.payload) for whichever
 * channel it's tagged with (WhatsApp, Instagram — see channel below; each
 * channel's webhook route in src/routes/webhook.js normalizes into this
 * same internal shape before enqueueing, tagging `channel` explicitly).
 * The webhook route just enqueues it and returns 200 immediately; this is
 * where the actual work happens, off the request/response cycle, with
 * retries on failure via the jobs queue.
 */
async function processInboundMessage(body) {
  const channel = body?.channel || "whatsapp";
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const messages = value?.messages;

  if (!messages || messages.length === 0) {
    // Delivery/read status callbacks and other non-message events land here.
    return;
  }

  // The identifier the customer messaged — the seller's WhatsApp business
  // number, or their linked Instagram account ID — determines whose
  // catalog/FAQs the agent should use.
  const recipientId = value?.metadata?.display_phone_number;
  const seller = await resolveSellerByChannel(channel, recipientId);

  if (!seller) {
    console.warn(
      `No seller configured for ${channel} recipient "${recipientId}" — ignoring message(s). Check the sellers table / run "npm run seed".`
    );
    return;
  }

  for (const message of messages) {
    const from = message.from; // sender's identifier on this channel
    if (!from) continue;

    // Cheap DB count, checked before any Claude call — protects against a
    // single abusive sender (regardless of which seller) running up costs.
    if (await isRateLimited(from)) {
      await recordRateLimitedMessage(seller, message, channel);
      continue;
    }

    if (message.type === "text") {
      const text = message.text?.body?.trim();
      if (!text) continue;

      await handleIncomingMessage(seller, from, text, message.id, channel);
    } else {
      await handleMediaMessage(seller, message, channel);
    }
  }
}

/**
 * A number over the rate limit still gets its message recorded (for the
 * record / dashboard visibility) but no reply is generated — dropping the
 * expensive part (Claude calls, WhatsApp sends) rather than crashing or
 * silently vanishing the message entirely.
 */
async function recordRateLimitedMessage(seller, message, channel) {
  if (message.id && (await findMessageBySourceId(message.id))) return;

  const from = message.from;
  const type = message.type;
  const content =
    type === "text"
      ? message.text?.body?.trim() || ""
      : `[Customer sent ${MEDIA_LABELS[type] || "something"}]`;

  let conversation = await getOrCreateConversation(seller.id, from, channel);
  conversation = await reopenIfClosed(conversation);

  await saveMessage(conversation.id, "customer", content, {
    sourceMessageId: message.id,
    mediaType: type !== "text" ? type : null,
    mediaId: type !== "text" ? message[type]?.id || null : null,
  });

  console.warn(
    `Rate limit exceeded for ${from} (> ${MAX_MESSAGES_PER_HOUR} messages/hour) — message saved but no reply generated.`
  );
}

/** A new message always reopens an auto-closed conversation. */
async function reopenIfClosed(conversation) {
  if (conversation.status !== "closed") return conversation;
  return setConversationStatus(conversation.id, "open");
}

/** Sends a channel-appropriate reply, degrading gracefully (log only) while credentials are placeholders/missing. */
async function sendReplySafely(channel, seller, to, reply) {
  try {
    await sendChannelMessage(channel, seller, to, reply);
  } catch (err) {
    console.warn(`${channel} send failed (${err.message})`);
    console.log(`Would have sent to ${channel}: ${reply}`);
  }
}

/**
 * Non-text messages (images, audio, documents, ...) get a sensible canned
 * reply instead of being ignored or crashing the agent — full media
 * understanding is a later phase. The media type/id are recorded so the
 * dashboard can show what was sent.
 */
async function handleMediaMessage(seller, message, channel) {
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

  let conversation = await getOrCreateConversation(seller.id, from, channel);
  conversation = await reopenIfClosed(conversation);

  await saveMessage(conversation.id, "customer", content, {
    sourceMessageId: message.id,
    mediaType: type,
    mediaId,
  });
  await saveMessage(conversation.id, "agent", reply);

  await sendReplySafely(channel, seller, from, reply);
}

/**
 * Each channel's own message ID (WhatsApp's wamid, Instagram's mid) doubles
 * as an idempotency key, since a retried job (after a transient failure
 * downstream) or a genuine webhook redelivery must not send the customer a
 * duplicate reply. If this exact message was already fully handled (already
 * has an agent reply after it), skip entirely. If it was partially handled
 * (saved but never got a reply, e.g. Claude failed last attempt), resume
 * from there instead of re-saving it.
 */
async function handleIncomingMessage(seller, from, text, sourceMessageId, channel) {
  const existing = sourceMessageId ? await findMessageBySourceId(sourceMessageId) : null;

  if (existing) {
    const alreadyReplied = await hasReplyAfter(existing.conversationId, existing.timestamp);
    if (alreadyReplied) {
      console.log(`Skipping already-processed message ${sourceMessageId}`);
      return;
    }
  }

  let conversation = existing
    ? await getConversationById(existing.conversationId)
    : await getOrCreateConversation(seller.id, from, channel);
  conversation = await reopenIfClosed(conversation);

  // Once a conversation is flagged, the agent stops generating fresh Claude
  // replies for it — a human needs to resolve it (dashboard "Resolve"
  // button, see routes/dashboard.js) before normal handling resumes. The
  // customer's message is still recorded either way.
  if (conversation.status === "needs_attention") {
    if (!existing) {
      await saveMessage(conversation.id, "customer", text, { sourceMessageId });
    }
    await saveMessage(conversation.id, "agent", NEEDS_ATTENTION_HOLDING_REPLY);
    await sendReplySafely(channel, seller, from, NEEDS_ATTENTION_HOLDING_REPLY);
    return;
  }

  // Fetch prior context BEFORE saving this message, so we don't double it up.
  const history = existing
    ? await getMessagesBefore(conversation.id, existing.timestamp, 20)
    : await getRecentMessages(conversation.id, 20);

  if (!existing) {
    await saveMessage(conversation.id, "customer", text, { sourceMessageId });
  }

  const { reply, flagged, flagReason } = await generateReply({
    seller,
    conversationId: conversation.id,
    history,
    incomingText: text,
  });

  await saveMessage(conversation.id, "agent", reply);

  if (flagged) {
    await setConversationStatus(conversation.id, "needs_attention");
    await notifyNeedsAttention({ seller, conversation, reason: flagReason });
  }

  await sendReplySafely(channel, seller, from, reply);
}

module.exports = { processInboundMessage };
