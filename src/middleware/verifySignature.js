const crypto = require("crypto");
const { verifyTwilioSignature } = require("../whatsapp/providers/twilio");

/**
 * Verifies Meta's X-Hub-Signature-256 header on incoming webhook POSTs,
 * rejecting anything that isn't genuinely from Meta before any processing
 * happens. Requires the raw request body (see express.json's `verify`
 * option in src/index.js) since the signature is computed over the exact
 * bytes Meta sent, not the re-serialized parsed JSON.
 *
 * Set VERIFY_WEBHOOK_SIGNATURE=false to bypass entirely — needed for local
 * testing via scripts/simulate-message.js when WHATSAPP_APP_SECRET isn't
 * set yet (the simulator signs its requests for real when the secret IS
 * set, so this bypass is only a fallback, not the primary test path).
 */
function verifyMetaSignature(req, res, next) {
  if (process.env.VERIFY_WEBHOOK_SIGNATURE === "false") {
    return next();
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error(
      "WHATSAPP_APP_SECRET is not set — refusing webhook request. Set VERIFY_WEBHOOK_SIGNATURE=false in .env to bypass for local testing."
    );
    return res.sendStatus(403);
  }

  const signatureHeader = req.get("X-Hub-Signature-256");
  if (!signatureHeader || !req.rawBody) {
    console.warn("Webhook request missing signature or raw body — rejecting.");
    return res.sendStatus(403);
  }

  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");

  const signatureBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);

  const valid =
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!valid) {
    console.warn("Webhook signature mismatch — rejecting.");
    return res.sendStatus(403);
  }

  next();
}

/** Dispatches to the Meta or Twilio signature check based on WHATSAPP_PROVIDER — see src/whatsapp/client.js for the matching send-side dispatcher. */
function verifyWebhookSignature(req, res, next) {
  if (process.env.WHATSAPP_PROVIDER === "twilio") {
    return verifyTwilioSignature(req, res, next);
  }
  return verifyMetaSignature(req, res, next);
}

module.exports = { verifyWebhookSignature, verifyMetaSignature };
