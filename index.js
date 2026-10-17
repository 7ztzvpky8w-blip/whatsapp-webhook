
require('dotenv').config();

const express = require('express');
const app = express();

app.use(express.json({ limit: '1mb' }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "TheMastersCutWebhook";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPT_OUT_API_KEY = process.env.MCR_WHATSAPP_OPTOUT_API_KEY;

const OPT_OUT_URL =
  "https://rewards.themasterscutgh.com/api/whatsapp/promotional-optout";

const STOP_WORDS = new Set([
  "STOP",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT"
]);

app.get("/", (req, res) => {
  res.send("WhatsApp Webhook is running.");
});

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

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    // Ignore delivery receipts and other non-message events.
    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;

    if (message.type === "text") {
      const textBody = String(message.text?.body || "").trim();

      // Recognize opt-out keywords, regardless of capitalization.
      const normalizedText = textBody
        .toUpperCase()
        .replace(/[.!?,;:]+$/g, "")
        .trim();

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

        // Never send the normal automatic reply to an opt-out request.
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
