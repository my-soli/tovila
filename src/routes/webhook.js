const express = require("express");
const { enqueueJob } = require("../jobs/queue");
const { verifyWebhookSignature } = require("../middleware/verifySignature");
const { normalizeTwilioPayload } = require("../whatsapp/providers/twilio");

const router = express.Router();

// GET /webhook — Meta's one-time webhook verification challenge. Twilio has
// no equivalent GET handshake, so this route is simply never hit when
// WHATSAPP_PROVIDER=twilio.
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified by Meta.");
    return res.status(200).send(challenge);
  }

  console.warn("Webhook verification failed.");
  return res.sendStatus(403);
});

// POST /webhook — incoming WhatsApp messages / status updates. Both
// providers expect a fast 2xx or they'll retry (and redeliver) — so we ack
// immediately and hand the payload off to the job queue (src/jobs/) for
// actual processing, with retries on failure.
router.post("/", verifyWebhookSignature, (req, res) => {
  res.sendStatus(200);

  const payload =
    process.env.WHATSAPP_PROVIDER === "twilio" ? normalizeTwilioPayload(req.body) : req.body;

  enqueueJob("process_inbound_message", payload).catch((err) => {
    console.error("Failed to enqueue inbound message job:", err);
  });
});

module.exports = router;
