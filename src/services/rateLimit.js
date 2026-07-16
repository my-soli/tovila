const prisma = require("../db/client");

const MAX_MESSAGES_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

/**
 * True if this raw phone number (regardless of which seller they're
 * messaging) has sent more than MAX_MESSAGES_PER_HOUR customer messages in
 * the last hour. Protects against abuse/cost spikes from a single number.
 */
async function isRateLimited(customerPhone) {
  const count = await prisma.message.count({
    where: {
      sender: "customer",
      conversation: { customerPhone },
      timestamp: { gt: new Date(Date.now() - HOUR_MS) },
    },
  });

  return count > MAX_MESSAGES_PER_HOUR;
}

module.exports = { isRateLimited, MAX_MESSAGES_PER_HOUR };
