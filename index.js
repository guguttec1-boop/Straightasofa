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
const WEBHOOK_URL = process.env.WEBHOOK_URL;  // now set!

// ======================================================
// ENVIRONMENT CHECKS
// ======================================================
if (!BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is missing");
  process.exit(1);
}
if (!process.env.FIREBASE_PROJECT_ID) {
  console.error("ERROR: FIREBASE_PROJECT_ID is missing");
  process.exit(1);
}
if (!process.env.FIREBASE_CLIENT_EMAIL) {
  console.error("ERROR: FIREBASE_CLIENT_EMAIL is missing");
  process.exit(1);
}
if (!process.env.FIREBASE_PRIVATE_KEY) {
  console.error("ERROR: FIREBASE_PRIVATE_KEY is missing");
  process.exit(1);
}

// ======================================================
// FIREBASE INIT
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
// TELEGRAM API HELPER
// ======================================================
async function telegram(method, params = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(data)}`);
  }
  return data.result;
}

// ======================================================
// GET FILE URL FROM TELEGRAM FILE ID
// ======================================================
async function getTelegramFileUrl(fileId) {
  if (!fileId) return null;
  try {
    const file = await telegram("getFile", { file_id: fileId });
    if (!file.file_path) return null;
    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  } catch (error) {
    console.error("Could not convert file_id to URL:", fileId, error.message);
    return null;
  }
}

// ======================================================
// EXTRACT MEDIA FROM MESSAGE
// ======================================================
function extractMedia(message) {
  const media = [];

  // PHOTO
  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    const largestPhoto = message.photo[message.photo.length - 1];
    media.push({
      type: "image",
      file_id: largestPhoto.file_id,
      width: largestPhoto.width || null,
      height: largestPhoto.height || null
    });
  }

  // VIDEO
  if (message.video) {
    media.push({
      type: "video",
      file_id: message.video.file_id,
      width: message.video.width || null,
      height: message.video.height || null,
      duration: message.video.duration || null,
      file_size: message.video.file_size || null
    });
  }

  // ANIMATION / GIF
  if (message.animation) {
    media.push({
      type: "animation",
      file_id: message.animation.file_id,
      width: message.animation.width || null,
      height: message.animation.height || null,
      duration: message.animation.duration || null
    });
  }

  // DOCUMENT
  if (message.document) {
    media.push({
      type: "document",
      file_id: message.document.file_id,
      file_name: message.document.file_name || null,
      mime_type: message.document.mime_type || null,
      file_size: message.document.file_size || null
    });
  }

  // AUDIO
  if (message.audio) {
    media.push({
      type: "audio",
      file_id: message.audio.file_id,
      file_name: message.audio.file_name || null,
      mime_type: message.audio.mime_type || null,
      duration: message.audio.duration || null
    });
  }

  return media;
}

// ======================================================
// HANDLE CHANNEL POST – saves to Firebase
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
// WEBHOOK ENDPOINT
// ======================================================
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update.channel_post) {
      await handleChannelPost(update.channel_post);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

// ======================================================
// START SERVER AND SET WEBHOOK
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
