const prisma = require("../db/client");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Basic per-seller stats for the dashboard — simple counts/averages
 * computed from existing tables, no separate analytics pipeline.
 */
async function getSellerStats(sellerId) {
  const totalConversations = await prisma.conversation.count({ where: { sellerId } });
  const totalLeads = await prisma.lead.count({ where: { conversation: { sellerId } } });

  const now = Date.now();
  const messagesThisWeek = await prisma.message.count({
    where: { conversation: { sellerId }, timestamp: { gt: new Date(now - 7 * DAY_MS) } },
  });
  const messagesThisMonth = await prisma.message.count({
    where: { conversation: { sellerId }, timestamp: { gt: new Date(now - 30 * DAY_MS) } },
  });

  const avgResponseTimeSeconds = await computeAvgResponseTimeSeconds(sellerId);

  return { totalConversations, totalLeads, avgResponseTimeSeconds, messagesThisWeek, messagesThisMonth };
}

/**
 * Averages the time between each customer message and the next agent reply
 * that follows it, across all conversations for the seller. If a customer
 * sends several messages before a reply, the delta is measured from the
 * first of them (closer to how long the customer actually felt they waited).
 */
async function computeAvgResponseTimeSeconds(sellerId) {
  const messages = await prisma.message.findMany({
    where: { conversation: { sellerId } },
    orderBy: [{ conversationId: "asc" }, { timestamp: "asc" }],
    select: { conversationId: true, sender: true, timestamp: true },
  });

  const deltasMs = [];
  let currentConversationId = null;
  let pendingCustomerTimestamp = null;

  for (const m of messages) {
    if (m.conversationId !== currentConversationId) {
      currentConversationId = m.conversationId;
      pendingCustomerTimestamp = null;
    }

    if (m.sender === "customer") {
      if (pendingCustomerTimestamp === null) pendingCustomerTimestamp = m.timestamp;
    } else if (m.sender === "agent" && pendingCustomerTimestamp !== null) {
      deltasMs.push(m.timestamp.getTime() - pendingCustomerTimestamp.getTime());
      pendingCustomerTimestamp = null;
    }
  }

  if (deltasMs.length === 0) return null;

  const avgMs = deltasMs.reduce((sum, d) => sum + d, 0) / deltasMs.length;
  return Math.round(avgMs / 1000);
}

module.exports = { getSellerStats };
