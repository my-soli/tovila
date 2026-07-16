const { isWithin24hWindow } = require("./messagingWindow");
const { saveMessage } = require("./conversation");
const { sendWhatsAppMessage } = require("../whatsapp/client");
const { sendWhatsAppTemplateMessage } = require("../whatsapp/templates");

// "pending" has no composer — it's the initial state, no customer-facing
// notification needed for it.
const STATUS_MESSAGES = {
  confirmed: (lead) =>
    `Good news — your order for ${describeItem(lead)} has been confirmed! We'll notify you once it ships.`,
  shipped: (lead) =>
    `Your order for ${describeItem(lead)} has shipped and is on its way to ${lead.deliveryLocation}.`,
  delivered: (lead) =>
    `Your order for ${describeItem(lead)} has been delivered. Thank you for shopping with us!`,
  cancelled: (lead) =>
    `Your order for ${describeItem(lead)} has been cancelled. Please reach out if you have any questions.`,
};

function describeItem(lead) {
  return lead.variant ? `${lead.item} (${lead.variant})` : lead.item;
}

/**
 * Sends the customer a WhatsApp update when their order's status changes.
 * Picks free-form text if the conversation is still within WhatsApp's 24h
 * customer-initiated window, or the (stub) template path otherwise — same
 * graceful-failure pattern as the rest of the app if the send itself fails.
 */
async function notifyCustomerOfStatusChange(lead) {
  const composeMessage = STATUS_MESSAGES[lead.status];
  if (!composeMessage) return;

  const message = composeMessage(lead);
  const conversation = lead.conversation;
  const to = conversation.customerPhone;

  const withinWindow = await isWithin24hWindow(conversation.id);

  try {
    if (withinWindow) {
      await sendWhatsAppMessage(to, message);
    } else {
      // Outside the 24h window — free-form text would be rejected by Meta;
      // this uses the stub template path (see whatsapp/templates.js).
      await sendWhatsAppTemplateMessage(to, "ORDER_STATUS_UPDATE", lead.item, lead.status);
    }
  } catch (err) {
    console.warn(`WhatsApp send failed (${err.message})`);
    console.log(`Would have sent to WhatsApp: ${message}`);
  }

  await saveMessage(conversation.id, "agent", message);
}

module.exports = { notifyCustomerOfStatusChange };
