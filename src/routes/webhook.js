const express = require("express");
const { enqueueJob } = require("../jobs/queue");
const { verifyWebhookSignature } = require("../middleware/verifySignature");

const router = express.Router();

// GET /webhook — Meta's one-time webhook verification challenge.
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

// POST /webhook — incoming WhatsApp messages / status updates.
// Meta expects a 2xx response within a few seconds or it will retry (and you
// get duplicate deliveries) — so we ack immediately and hand the payload off
// to the job queue (src/jobs/) for actual processing, with retries on failure.
router.post("/", verifyWebhookSignature, (req, res) => {
  res.sendStatus(200);

  enqueueJob("process_inbound_message", req.body).catch((err) => {
    console.error("Failed to enqueue inbound message job:", err);
  });
});

module.exports = router;
