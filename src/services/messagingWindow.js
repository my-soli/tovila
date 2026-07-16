const prisma = require("../db/client");

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * WhatsApp only allows free-form business-initiated messages within 24h of
 * the customer's last inbound message — anything later must use an
 * approved template (see src/whatsapp/templates.js). Returns false if the
 * customer has never messaged at all (no window exists yet).
 */
async function isWithin24hWindow(conversationId) {
  const lastCustomerMessage = await prisma.message.findFirst({
    where: { conversationId, sender: "customer" },
    orderBy: { timestamp: "desc" },
  });

  if (!lastCustomerMessage) return false;

  return Date.now() - lastCustomerMessage.timestamp.getTime() < WINDOW_MS;
}

module.exports = { isWithin24hWindow };
