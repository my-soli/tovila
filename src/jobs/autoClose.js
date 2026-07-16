const prisma = require("../db/client");

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const INACTIVITY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Closes "open" conversations that have had no messages in the last 24h.
 * Only ever touches "open" conversations — a needs_attention thread never
 * silently expires out from under a seller who hasn't resolved it yet.
 */
async function sweepInactiveConversations() {
  const cutoff = new Date(Date.now() - INACTIVITY_MS);

  const result = await prisma.conversation.updateMany({
    where: {
      status: "open",
      messages: { none: { timestamp: { gt: cutoff } } },
    },
    data: { status: "closed" },
  });

  if (result.count > 0) {
    console.log(`Auto-closed ${result.count} inactive conversation(s).`);
  }
}

function startAutoCloseSweep() {
  console.log(`Auto-close sweep started (every ${SWEEP_INTERVAL_MS / 60000} min, 24h inactivity threshold).`);
  const interval = setInterval(() => {
    sweepInactiveConversations().catch((err) =>
      console.error("Auto-close sweep failed:", err)
    );
  }, SWEEP_INTERVAL_MS);

  return () => clearInterval(interval);
}

module.exports = { startAutoCloseSweep, sweepInactiveConversations };
