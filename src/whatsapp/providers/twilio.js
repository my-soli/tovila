const crypto = require("crypto");

const MEDIA_TYPE_BY_MIME_PREFIX = {
  image: "image",
  video: "video",
  audio: "audio",
};

function stripWhatsappPrefix(value) {
  return (value || "").replace(/^whatsapp:/, "").replace(/^\+/, "");
}

/**
 * Twilio signs the exact callback URL plus all POST params (sorted by key,
 * concatenated as key+value) with the Auth Token via HMAC-SHA1, base64
 * encoded, in X-Twilio-Signature. Unlike Meta's scheme, it needs the parsed
 * params rather than raw bytes, but it does need the exact URL Twilio thinks
 * it called — behind a tunnel (ngrok) or a proxy, req.protocol/req.get("host")
 * can disagree with that, so TWILIO_WEBHOOK_URL is an explicit override.
 */
function verifyTwilioSignature(req, res, next) {
  if (process.env.VERIFY_WEBHOOK_SIGNATURE === "false") {
    return next();
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error(
      "TWILIO_AUTH_TOKEN is not set — refusing webhook request. Set VERIFY_WEBHOOK_SIGNATURE=false in .env to bypass for local testing."
    );
    return res.sendStatus(403);
  }

  const signatureHeader = req.get("X-Twilio-Signature");
  if (!signatureHeader) {
    console.warn("Webhook request missing X-Twilio-Signature — rejecting.");
    return res.sendStatus(403);
  }

  const url =
    process.env.TWILIO_WEBHOOK_URL || `${req.protocol}://${req.get("host")}${req.originalUrl}`;

  const sortedParamString = Object.keys(req.body)
    .sort()
    .reduce((acc, key) => acc + key + req.body[key], url);

  const expected = crypto.createHmac("sha1", authToken).update(sortedParamString).digest("base64");

  const signatureBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);

  const valid =
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!valid) {
    console.warn("Twilio webhook signature mismatch — rejecting.");
    return res.sendStatus(403);
  }

  next();
}

/**
 * Converts Twilio's form-encoded webhook body into the same nested shape
 * Meta's Cloud API sends, so processInboundMessage.js and everything
 * downstream never has to know which provider actually delivered the
 * message. mediaId here ends up holding a fetchable Twilio media URL rather
 * than an opaque Meta media id — that's provider-specific, but it's stored
 * in the same field since nothing downstream dereferences it yet.
 */
function normalizeTwilioPayload(body) {
  const from = stripWhatsappPrefix(body.From);
  const to = stripWhatsappPrefix(body.To);
  const numMedia = parseInt(body.NumMedia || "0", 10);

  let message;
  if (numMedia > 0) {
    const mimeType = body.MediaContentType0 || "";
    const type = MEDIA_TYPE_BY_MIME_PREFIX[mimeType.split("/")[0]] || "document";
    message = {
      from,
      id: body.MessageSid,
      type,
      [type]: { id: body.MediaUrl0 },
    };
  } else {
    message = {
      from,
      id: body.MessageSid,
      type: "text",
      text: { body: body.Body || "" },
    };
  }

  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: to },
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

/**
 * Sends a plain-text WhatsApp message via the Twilio API. `to` is a phone
 * number with no leading "+" (same convention as the Meta path), converted
 * here to Twilio's "whatsapp:+<number>" address format.
 */
async function sendTwilioMessage(to, text) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error(
      "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_NUMBER are not set — check your .env"
    );
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({
    From: `whatsapp:+${fromNumber}`,
    To: `whatsapp:+${to}`,
    Body: text,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Twilio WhatsApp send failed (${res.status}): ${errBody}`);
  }

  return res.json();
}

module.exports = { verifyTwilioSignature, normalizeTwilioPayload, sendTwilioMessage };
