const prisma = require("../db/client");

/**
 * Finds the most recent conversation for a given seller + customer phone
 * pair, or creates a new one. The same customer messaging two different
 * sellers gets two separate conversations.
 */
async function getOrCreateConversation(sellerId, customerPhone) {
  let conversation = await prisma.conversation.findFirst({
    where: { sellerId, customerPhone },
    orderBy: { createdAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { sellerId, customerPhone },
    });
  }

  return conversation;
}

/** Returns up to `limit` most recent messages, oldest first. */
async function getRecentMessages(conversationId, limit = 20) {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return messages.reverse();
}

/** Same as getRecentMessages, but strictly before a given timestamp. */
async function getMessagesBefore(conversationId, before, limit = 20) {
  const messages = await prisma.message.findMany({
    where: { conversationId, timestamp: { lt: before } },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return messages.reverse();
}

/** True if an agent message already followed the given timestamp — i.e. this customer message already got its reply. */
async function hasReplyAfter(conversationId, timestamp) {
  const reply = await prisma.message.findFirst({
    where: { conversationId, sender: "agent", timestamp: { gt: timestamp } },
  });
  return Boolean(reply);
}

async function saveMessage(conversationId, sender, content, options = {}) {
  const { sourceMessageId, mediaType, mediaId } = options;
  return prisma.message.create({
    data: { conversationId, sender, content, sourceMessageId, mediaType, mediaId },
  });
}

/**
 * Looks up a message by Meta's own message id (wamid). Used to make job
 * processing idempotent — a retried job (or a genuine webhook redelivery
 * from Meta) must not re-save the same inbound message twice.
 */
async function findMessageBySourceId(sourceMessageId) {
  if (!sourceMessageId) return null;
  return prisma.message.findUnique({ where: { sourceMessageId } });
}

/**
 * Returns every conversation for a seller with a one-message preview (the
 * latest message). Sorted with needs_attention conversations pinned first
 * (they need eyes on them regardless of recency), then by the latest
 * message's timestamp descending. Conversations with no messages yet sort
 * by their own createdAt instead.
 */
async function listConversationsWithPreview(sellerId) {
  const conversations = await prisma.conversation.findMany({
    where: { sellerId },
    include: {
      messages: { orderBy: { timestamp: "desc" }, take: 1 },
    },
  });

  return conversations
    .map((c) => ({
      id: c.id,
      customerPhone: c.customerPhone,
      status: c.status,
      createdAt: c.createdAt,
      lastMessage: c.messages[0] || null,
      lastActivityAt: c.messages[0]?.timestamp || c.createdAt,
    }))
    .sort((a, b) => {
      const aFlagged = a.status === "needs_attention";
      const bFlagged = b.status === "needs_attention";
      if (aFlagged !== bFlagged) return aFlagged ? -1 : 1;
      return b.lastActivityAt - a.lastActivityAt;
    });
}

async function getConversationById(conversationId) {
  return prisma.conversation.findUnique({ where: { id: conversationId } });
}

async function setConversationStatus(conversationId, status) {
  return prisma.conversation.update({ where: { id: conversationId }, data: { status } });
}

/** Returns a conversation (with its seller) and its full message thread, oldest first. */
async function getConversationWithMessages(conversationId) {
  return prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      seller: true,
      messages: { orderBy: { timestamp: "asc" } },
    },
  });
}

module.exports = {
  getOrCreateConversation,
  getConversationById,
  setConversationStatus,
  getRecentMessages,
  getMessagesBefore,
  hasReplyAfter,
  saveMessage,
  findMessageBySourceId,
  listConversationsWithPreview,
  getConversationWithMessages,
};
