const { sendMetaMessage, postToMeta } = require("./providers/meta");
const { sendTwilioMessage } = require("./providers/twilio");

/**
 * Set WHATSAPP_PROVIDER=twilio to send/receive over Twilio's WhatsApp API
 * instead of Meta's Cloud API directly — e.g. while Meta business
 * verification is pending. Everything above this dispatcher (the agent, job
 * handlers, dashboard) calls sendWhatsAppMessage and never needs to know
 * which provider is actually wired up.
 */
async function sendWhatsAppMessage(to, text) {
  if (process.env.WHATSAPP_PROVIDER === "twilio") {
    return sendTwilioMessage(to, text);
  }
  return sendMetaMessage(to, text);
}

module.exports = { sendWhatsAppMessage, postToWhatsApp: postToMeta };
