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
  const ordersByStatus = await computeOrdersByStatus(sellerId);
  const paidCount = await prisma.lead.count({ where: { conversation: { sellerId }, paid: true } });
  const unpaidCount = totalLeads - paidCount;
  const messagesByDay = await computeMessagesByDay(sellerId, 7);

  return {
    totalConversations,
    totalLeads,
    avgResponseTimeSeconds,
    messagesThisWeek,
    messagesThisMonth,
    ordersByStatus,
    paidCount,
    unpaidCount,
    messagesByDay,
  };
}

/** Message counts for each of the last `days` calendar days (oldest first), for a simple activity chart. */
async function computeMessagesByDay(sellerId, days) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeStart = new Date(startOfToday.getTime() - (days - 1) * DAY_MS);

  const messages = await prisma.message.findMany({
    where: { conversation: { sellerId }, timestamp: { gte: rangeStart } },
    select: { timestamp: true },
  });

  const countByDay = {};
  for (const m of messages) {
    const key = m.timestamp.toISOString().slice(0, 10);
    countByDay[key] = (countByDay[key] || 0) + 1;
  }

  const result = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(rangeStart.getTime() + i * DAY_MS);
    const key = day.toISOString().slice(0, 10);
    result.push({
      date: key,
      label: day.toLocaleDateString(undefined, { weekday: "short" }),
      count: countByDay[key] || 0,
    });
  }
  return result;
}

const ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];

/** Count of orders per fulfillment status, in the fixed lifecycle order (zero-filled for statuses with no orders yet). */
async function computeOrdersByStatus(sellerId) {
  const leads = await prisma.lead.findMany({
    where: { conversation: { sellerId } },
    select: { status: true },
  });

  const countByStatus = {};
  for (const lead of leads) {
    countByStatus[lead.status] = (countByStatus[lead.status] || 0) + 1;
  }

  return ORDER_STATUSES.map((status) => ({ status, count: countByStatus[status] || 0 }));
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
