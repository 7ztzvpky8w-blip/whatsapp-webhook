require('dotenv').config();

const express = require('express');
const app = express();

app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "TheMastersCutWebhook";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;

    if (message.type === "text") {
      const incomingText = message.text.body;

      console.log(`Message from ${from}: ${incomingText}`);

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
              body: `Thank you for contacting The Master's Cut! We received your message: "${incomingText}"`
            }
          })
        }
      );

      const result = await response.json();

      console.log(
        "WhatsApp reply result:",
        JSON.stringify(result, null, 2)
      );
    }

    res.sendStatus(200);

  } catch (error) {
    console.error("Error sending WhatsApp reply:", error);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
