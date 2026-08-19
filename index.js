
const express = require("express");
const admin = require("firebase-admin");
const app = express();
app.use(express.json({ limit: "10mb" }));

// ======================================================
// CONFIGURATION
// ======================================================
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DATABASE_URL = "https://r-second-default-rtdb.firebaseio.com/";
const WEBHOOK_URL = process.env.WEBHOOK_URL;  // <-- SET THIS on Render

// ======================================================
// ENVIRONMENT CHECKS (keep your existing checks)
// ======================================================
if (!BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is missing");
  process.exit(1);
}
// ... (keep all your existing checks for FIREBASE_PROJECT_ID, etc.)

// ======================================================
// FIREBASE INIT (keep your existing init)
// ======================================================
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  }),
  databaseURL: DATABASE_URL
});
const db = admin.database();
const POSTS_REF = db.ref("sofa/new");

// ======================================================
// TELEGRAM API HELPER (keep your existing telegram() function)
// ======================================================
async function telegram(method, params = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  return data.result;
}

// ======================================================
// KEEP YOUR EXISTING: getTelegramFileUrl(), extractMedia()
// (copy them exactly as you have)
// ======================================================

// ======================================================
// NEW: Handle channel post and save to Firebase
// ======================================================
async function handleChannelPost(message) {
  const text = message.text || message.caption || '';
  const mediaList = extractMedia(message);
  const mediaWithUrls = await Promise.all(
    mediaList.map(async (media) => {
      const url = await getTelegramFileUrl(media.file_id);
      return { ...media, url };
    })
  );

  const data = {
    text,
    media: mediaWithUrls,
    date: message.date || Date.now(),
    channel_id: message.chat?.id || null,
    message_id: message.message_id || null,
  };

  try {
    const newRef = POSTS_REF.push();
    await newRef.set(data);
    console.log('✅ Post saved, key:', newRef.key);
  } catch (error) {
    console.error('❌ Firebase write error:', error);
  }
}

// ======================================================
// NEW: Webhook endpoint – Telegram will POST to this
// ======================================================
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.channel_post) {
      await handleChannelPost(update.channel_post);
    }
    res.sendStatus(200);  // Always acknowledge Telegram
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// ======================================================
// NEW: Start server AND set webhook
// ======================================================
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  if (WEBHOOK_URL) {
    const webhookEndpoint = `${WEBHOOK_URL}/webhook`;
    try {
      await telegram('setWebhook', { url: webhookEndpoint });
      console.log(`✅ Webhook set to ${webhookEndpoint}`);
    } catch (err) {
      console.error('❌ Failed to set webhook:', err.message);
    }
  } else {
    console.warn('⚠️ WEBHOOK_URL not set – Telegram won\'t send updates.');
  }
});
