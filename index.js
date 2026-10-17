
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const app = express();

// Preserve the original request body for Meta signature verification.
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => {
    req.rawBody = Buffer.from(buffer);
  }
}));

// Environment configuration.
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "TheMastersCutWebhook";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPT_OUT_API_KEY = process.env.MCR_WHATSAPP_OPTOUT_API_KEY;
const META_APP_SECRET = process.env.META_APP_SECRET;

const OPT_OUT_URL =
  "https://rewards.themasterscutgh.com/api/whatsapp/promotional-optout";

// Verify that POST requests genuinely originate from Meta.
function verifyMetaSignature(req, res, next) {
  if (!META_APP_SECRET || !req.rawBody) {
    console.error("Meta webhook verification unavailable.");
    return res.sendStatus(403);
  }

  const signature = req.get("X-Hub-Signature-256") || "";

  if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) {
    console.error("Missing or invalid Meta webhook signature.");
    return res.sendStatus(403);
  }

  const expected = crypto
    .createHmac("sha256", META_APP_SECRET)
    .update(req.rawBody)
    .digest();

  const received = Buffer.from(signature.slice(7), "hex");

  if (!crypto.timingSafeEqual(expected, received)) {
    console.error("Meta webhook signature mismatch.");
    return res.sendStatus(403);
  }

  next();
}

// Promotional WhatsApp opt-out keywords.
const STOP_WORDS = new Set([
  "STOP",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT"
]);

// Basic service health check.
app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running.");
});

// Meta webhook verification challenge.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Process only requests that pass Meta signature verification.
app.post("/webhook", verifyMetaSignature, async (req, res) => {
  try {
    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        // Only process events for the configured Rewards WhatsApp number.
    const incomingPhoneNumberId =
      req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

    if (
      !PHONE_NUMBER_ID ||
      String(incomingPhoneNumberId || "") !== String(PHONE_NUMBER_ID)
    ) {
      console.log("Webhook ignored: phone number ID does not match Rewards.");
      return res.sendStatus(200);
    }

    // Ignore delivery receipts and other non-message events.
    if (!message) {
      const statuses =
        req.body?.entry?.[0]?.changes?.[0]?.value?.statuses;

      if (Array.isArray(statuses) && statuses.length > 0) {
        console.log("Verified Meta webhook: status event received.");
      }

      return res.sendStatus(200);
    }

    const from = message.from;

    if (message.type === "text") {
      const textBody = String(message.text?.body || "").trim();

      // Normalize case and trailing punctuation.
      const normalizedText = textBody
        .toUpperCase()
        .replace(/[.!?,;:]+$/g, "")
        .trim();

      // Process promotional opt-out requests.
      if (STOP_WORDS.has(normalizedText)) {
        console.log("Promotional opt-out request received.");

        if (!from || !/^\d{7,15}$/.test(from)) {
          console.error("Opt-out request has an invalid sender number.");
          return res.sendStatus(400);
        }

        if (!OPT_OUT_API_KEY) {
          console.error("Opt-out API key is not configured.");
          return res.sendStatus(500);
        }

        let response;

        try {
          response = await fetch(OPT_OUT_URL, {
            method: "POST",
            headers: {
              "X-API-Key": OPT_OUT_API_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              mobile: from
            }),
            signal: AbortSignal.timeout(10000)
          });
        } catch (error) {
          console.error("Rewards opt-out service is unreachable.");
          return res.sendStatus(502);
        }

        const result = await response.json().catch(() => null);

        if (
          !response.ok ||
          result?.ok !== true ||
          !["opted_out", "customer_not_found"].includes(result.status)
        ) {
          console.error(
            "Rewards opt-out processing failed. HTTP status:",
            response.status
          );
          return res.sendStatus(502);
        }

        console.log("Rewards opt-out result:", result.status);

        // Do not send the ordinary auto-reply to STOP requests.
        return res.sendStatus(200);
      }

      // Existing automatic reply for ordinary text messages.
      console.log("Ordinary text message received.");

      const response = await fetch(
        `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            type: "text",
            text: {
              body: `👋 Thank you for contacting The Master's Cut Loyalty Programme.

This WhatsApp number is used only for loyalty programme communications.

For appointments, services, prices, or any other enquiries, kindly WhatsApp our official The Master's Cut number: +233 50 458 8777.

Thank you for choosing The Master's Cut. ❤️

─────────────
This is an automated message. Please do not reply to this number.`
            }
          })
        }
      );

      console.log(
        "Automatic reply HTTP status:",
        response.status
      );
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error("Webhook processing failed.");
    return res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
