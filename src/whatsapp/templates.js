const { postToWhatsApp } = require("./client");

// TODO(meta-verification): these template names must exist and be APPROVED
// in Meta Business Manager before sendWhatsAppTemplateMessage will actually
// deliver anything — right now this will 4xx against the real Graph API,
// same as sendWhatsAppMessage does with placeholder credentials. The request
// shape below is the real one Meta expects; once a template is approved,
// wire its exact name/language/variable count in here and this is ready to
// go with no further code changes.
const TEMPLATES = {
  ORDER_STATUS_UPDATE: {
    name: "order_status_update",
    language: "en_US",
    // Example: one body variable, e.g. "Your order for {{1}} is now {{2}}."
    buildComponents: (item, status) => [
      {
        type: "body",
        parameters: [{ type: "text", text: item }, { type: "text", text: status }],
      },
    ],
  },
};

/**
 * Sends an approved WhatsApp template message — required outside the 24h
 * customer-initiated messaging window (see services/messagingWindow.js),
 * since free-form text (sendWhatsAppMessage) is rejected by Meta past that
 * window. `to` is the customer's number; `templateKey` must be a key in
 * TEMPLATES above.
 */
async function sendWhatsAppTemplateMessage(to, templateKey, ...componentArgs) {
  const template = TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown WhatsApp template "${templateKey}"`);
  }

  return postToWhatsApp({
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      components: template.buildComponents(...componentArgs),
    },
  });
}

module.exports = { sendWhatsAppTemplateMessage, TEMPLATES };
