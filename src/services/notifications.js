const prisma = require("../db/client");

let resendClient;

/** Lazily constructs a Resend client only if an API key is configured — email is optional. */
function getResendClient() {
  if (resendClient !== undefined) return resendClient;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    resendClient = null;
    return resendClient;
  }

  const { Resend } = require("resend");
  resendClient = new Resend(apiKey);
  return resendClient;
}

/**
 * Records that a conversation needs the seller's attention. Always writes a
 * Notification row (so it's visible/auditable via the DB regardless of any
 * email setup) and logs loudly to the console. Additionally sends an email
 * via Resend if RESEND_API_KEY and the seller's notification email are both
 * set — entirely optional, degrades gracefully (logged, never throws) if
 * that send fails, same pattern as WhatsApp sends elsewhere in this app.
 */
async function notifyNeedsAttention({ seller, conversation, reason }) {
  const message = reason
    ? `Conversation with ${conversation.customerPhone} needs your attention: ${reason}`
    : `Conversation with ${conversation.customerPhone} needs your attention.`;

  await prisma.notification.create({
    data: { sellerId: seller.id, conversationId: conversation.id, message },
  });

  console.warn(`[NEEDS ATTENTION] ${seller.name}: ${message}`);

  const resend = getResendClient();
  if (!resend || !seller.sellerNotificationEmail) return;

  try {
    await resend.emails.send({
      from: "Tovila <notifications@tovila.app>",
      to: seller.sellerNotificationEmail,
      subject: `[Tovila] ${seller.name}: a conversation needs your attention`,
      text: `${message}\n\nCustomer: ${conversation.customerPhone}\n\nOpen your Tovila dashboard to respond.`,
    });
  } catch (err) {
    console.warn(`Failed to send notification email: ${err.message}`);
  }
}

module.exports = { notifyNeedsAttention };
