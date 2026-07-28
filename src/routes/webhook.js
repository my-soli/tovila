const express = require("express");
const { enqueueJob } = require("../jobs/queue");
const { verifyWebhookSignature, verifyMetaSignature } = require("../middleware/verifySignature");
const { normalizeTwilioPayload } = require("../whatsapp/providers/twilio");
const { normalizeInstagramPayload } = require("../instagram/providers/meta");

const router = express.Router();

// Meta's one-time webhook verification challenge — shared by WhatsApp and
// Instagram, since both ride the same Meta App Dashboard webhook
// subscription mechanism (just a different subscribed field). Twilio has
// no equivalent GET handshake, so this route is simply never hit when
// WHATSAPP_PROVIDER=twilio.
function verifyMetaChallenge(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified by Meta.");
    return res.status(200).send(challenge);
  }

  console.warn("Webhook verification failed.");
  return res.sendStatus(403);
}

router.get("/", verifyMetaChallenge);
router.get("/instagram", verifyMetaChallenge);

// POST /webhook — incoming WhatsApp messages / status updates. Both
// providers expect a fast 2xx or they'll retry (and redeliver) — so we ack
// immediately and hand the payload off to the job queue (src/jobs/) for
// actual processing, with retries on failure. Twilio's webhook contract
// treats a non-empty response body as TwiML to act on — res.sendStatus(200)
// sends the literal text "OK", which Twilio can misinterpret as a reply to
// send back to the customer. An empty body avoids that entirely; the real
// reply is sent later via the Twilio REST API (src/whatsapp/providers/twilio.js).
router.post("/", verifyWebhookSignature, (req, res) => {
  res.status(200).end();

  const normalized =
    process.env.WHATSAPP_PROVIDER === "twilio" ? normalizeTwilioPayload(req.body) : req.body;
  const payload = { ...normalized, channel: "whatsapp" };

  enqueueJob("process_inbound_message", payload).catch((err) => {
    console.error("Failed to enqueue inbound message job:", err);
  });
});

// POST /webhook/instagram — same fast-ack-then-queue shape as WhatsApp
// above, tagged with channel: "instagram" so the job handler resolves the
// seller by their linked Instagram account instead of a phone number.
// Always verified as a Meta signature (never Twilio) — Instagram has no
// Twilio path, so this must not follow WHATSAPP_PROVIDER's dispatch.
router.post("/instagram", verifyMetaSignature, (req, res) => {
  res.status(200).end();

  const payload = { ...normalizeInstagramPayload(req.body), channel: "instagram" };

  enqueueJob("process_inbound_message", payload).catch((err) => {
    console.error("Failed to enqueue inbound Instagram message job:", err);
  });
});

module.exports = router;
