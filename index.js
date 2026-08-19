const express = require("express");
const admin = require("firebase-admin");

const app = express();
app.use(express.json({ limit: "10mb" }));

// ======================================================
// CONFIGURATION
// ======================================================

const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const DATABASE_URL =
  "https://r-second-default-rtdb.firebaseio.com/";

// Optional:
// Put your Render URL in WEBHOOK_URL if you want this code
// to automatically register the Telegram webhook.
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// ======================================================
// CHECK ENVIRONMENT VARIABLES
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
// FIREBASE
// ======================================================

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,

    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,

    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(
      /\\n/g,
      "\n"
    )
  }),

  databaseURL: DATABASE_URL
});

const db = admin.database();

const POSTS_REF = db.ref("sofa/new");

// ======================================================
// TELEGRAM API
// ======================================================

async function telegram(method, params = {}) {
  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify(params)
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Telegram API error: ${JSON.stringify(data)}`
    );
  }

  return data.result;
}

// ======================================================
// GET FILE URL FROM TELEGRAM FILE ID
// ======================================================

async function getTelegramFileUrl(fileId) {
  if (!fileId) {
    return null;
  }

  try {
    const file = await telegram("getFile", {
      file_id: fileId
    });

    if (!file.file_path) {
      return null;
    }

    return `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

  } catch (error) {
    console.error(
      "Could not convert file_id to URL:",
      fileId,
      error.message
    );

    return null;
  }
}

// ======================================================
// MEDIA EXTRACTION
// ======================================================

function extractMedia(message) {

  const media = [];

  // -----------------------------
  // PHOTO
  // -----------------------------

  if (
    message.photo &&
    Array.isArray(message.photo) &&
    message.photo.length > 0
  ) {

    // Telegram sends several resolutions.
    // The last one is normally the largest.
    const largestPhoto =
      message.photo[message.photo.length - 1];

    media.push({
      type: "image",
      file_id: largestPhoto.file_id,
      width: largestPhoto.width || null,
      height: largestPhoto.height || null
    });
  }

  // -----------------------------
  // VIDEO
  // -----------------------------

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

  // -----------------------------
  // ANIMATION / GIF
  // -----------------------------

  if (message.animation) {

    media.push({
      type: "animation",
      file_id: message.animation.file_id,
      width: message.animation.width || null,
      height: message.animation.height || null,
      duration: message.animation.duration || null
    });
  }

  // -----------------------------
  // DOCUMENT
  // -----------------------------

  if (message.document) {

    media.push({
      type: "document",
      file_id: message.document.file_id,
      file_name: message.document.file_name || null,
      mime_type: message.document.mime_type || null,
      file_size: message.document.file_size || null
    });
  }

  // -----------------------------
  // AUDIO
  // -----------------------------

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
// GET TEXT / CAPTION
// ======================================================

function getMessageText(message) {

  return (
    message.text ||
    message.caption ||
    ""
  );
}

// ======================================================
// CREATE SAFE FIREBASE KEY
// ======================================================

function safeFirebaseKey(value) {

  return String(value)
    .replace(/[.#$[\]/]/g, "_");
}

// ======================================================
// CREATE ID FOR SINGLE POST
// ======================================================

function createSinglePostId(message) {

  const chatId = safeFirebaseKey(message.chat.id);

  return `message_${chatId}_${message.message_id}`;
}

// ======================================================
// CREATE ID FOR ALBUM
// ======================================================

function createAlbumPostId(message) {

  const chatId = safeFirebaseKey(message.chat.id);

  return `album_${chatId}_${message.media_group_id}`;
}

// ======================================================
// ALBUM BUFFER
// ======================================================

// Telegram sends album items as separate updates.
// We temporarily collect them here.

const albumBuffers = new Map();


// ======================================================
// PROCESS SINGLE MESSAGE
// ======================================================

async function processSingleMessage(message) {

  const postId = createSinglePostId(message);

  const existing =
    await POSTS_REF.child(postId).once("value");

  if (existing.exists()) {

    console.log(
      "Already exists:",
      postId
    );

    return;
  }

  const media = extractMedia(message);

  const mediaWithUrls = [];

  for (const item of media) {

    const url =
      await getTelegramFileUrl(item.file_id);

    mediaWithUrls.push({

      type: item.type,

      file_id: item.file_id,

      url: url,

      width: item.width || null,

      height: item.height || null,

      duration: item.duration || null,

      file_size: item.file_size || null,

      file_name: item.file_name || null,

      mime_type: item.mime_type || null,

      url_updated_at:
        Date.now()
    });
  }

  const post = {

    id: postId,

    type: "single",

    chat_id: message.chat.id,

    chat_type: message.chat.type,

    chat_title:
      message.chat.title ||
      message.chat.username ||
      "",

    message_id: message.message_id,

    media_group_id:
      message.media_group_id || null,

    text:
      message.text || "",

    caption:
      message.caption || "",

    content:
      getMessageText(message),

    date:
      message.date
        ? message.date * 1000
        : Date.now(),

    created_at:
      Date.now(),

    media:
      mediaWithUrls,

    // Save the original Telegram message too.
    raw_message:
      message
  };

  await POSTS_REF
    .child(postId)
    .set(post);

  console.log(
    "Saved single post:",
    postId
  );
}

// ======================================================
// PROCESS ALBUM
// ======================================================

async function processAlbum(
  albumKey,
  messages
) {

  if (!messages || messages.length === 0) {
    return;
  }

  // Sort album messages by message ID
  messages.sort(
    (a, b) =>
      a.message_id - b.message_id
  );

  const firstMessage =
    messages[0];

  const postId =
    createAlbumPostId(firstMessage);

  const existing =
    await POSTS_REF.child(postId)
      .once("value");

  if (existing.exists()) {

    console.log(
      "Album already exists:",
      postId
    );

    return;
  }

  const media = [];

  let combinedText = "";
  let combinedCaption = "";

  // Process every message in the album
  for (const message of messages) {

    if (!combinedText) {
      combinedText =
        message.text || "";
    }

    if (!combinedCaption) {
      combinedCaption =
        message.caption || "";
    }

    const messageMedia =
      extractMedia(message);

    for (const item of messageMedia) {

      console.log(
        "Getting URL for album file:",
        item.file_id
      );

      const url =
        await getTelegramFileUrl(
          item.file_id
        );

      media.push({

        type:
          item.type,

        file_id:
          item.file_id,

        url:
          url,

        width:
          item.width || null,

        height:
          item.height || null,

        duration:
          item.duration || null,

        file_size:
          item.file_size || null,

        file_name:
          item.file_name || null,

        mime_type:
          item.mime_type || null,

        message_id:
          message.message_id,

        url_updated_at:
          Date.now()
      });
    }
  }

  const post = {

    id:
      postId,

    type:
      "album",

    chat_id:
      firstMessage.chat.id,

    chat_type:
      firstMessage.chat.type,

    chat_title:
      firstMessage.chat.title ||
      firstMessage.chat.username ||
      "",

    message_id:
      firstMessage.message_id,

    message_ids:
      messages.map(
        message =>
          message.message_id
      ),

    media_group_id:
      firstMessage.media_group_id,

    text:
      combinedText,

    caption:
      combinedCaption,

    content:
      combinedText ||
      combinedCaption,

    date:
      firstMessage.date
        ? firstMessage.date * 1000
        : Date.now(),

    created_at:
      Date.now(),

    media:
      media,

    media_count:
      media.length,

    raw_messages:
      messages
  };

  await POSTS_REF
    .child(postId)
    .set(post);

  console.log(
    "Saved album:",
    postId,
    "media:",
    media.length
  );
}

// ======================================================
// ADD MESSAGE TO ALBUM BUFFER
// ======================================================

function addToAlbum(message) {

  const chatId =
    safeFirebaseKey(message.chat.id);

  const albumKey =
    `${chatId}_${message.media_group_id}`;

  if (!albumBuffers.has(albumKey)) {

    albumBuffers.set(
      albumKey,
      {
        messages: [],
        timer: null
      }
    );
  }

  const album =
    albumBuffers.get(albumKey);

  // Prevent duplicate message
  const alreadyExists =
    album.messages.some(
      messageItem =>
        messageItem.message_id ===
        message.message_id
    );

  if (!alreadyExists) {

    album.messages.push(message);
  }

  // Reset timer.
  // Telegram normally sends the album items
  // very close together.

  if (album.timer) {
    clearTimeout(album.timer);
  }

  album.timer =
    setTimeout(
      async () => {

        try {

          await processAlbum(
            albumKey,
            album.messages
          );

        } catch (error) {

          console.error(
            "Album processing error:",
            error
          );
        }

        albumBuffers.delete(
          albumKey
        );

      },
      5000
    );
}

// ======================================================
// HANDLE TELEGRAM UPDATE
// ======================================================

async function handleTelegramUpdate(update) {

  // Channel post
  let message =
    update.channel_post;

  // Group / supergroup / normal message
  if (!message) {
    message =
      update.message;
  }

  // Edited channel post
  if (!message) {
    message =
      update.edited_channel_post;
  }

  // Edited group message
  if (!message) {
    message =
      update.edited_message;
  }

  if (!message) {

    console.log(
      "Update does not contain a supported message"
    );

    return;
  }

  // We need chat information
  if (!message.chat) {

    console.log(
      "Message has no chat information"
    );

    return;
  }

  // ----------------------------------------------------
  // ALBUM
  // ----------------------------------------------------

  if (message.media_group_id) {

    addToAlbum(message);

    return;
  }

  // ----------------------------------------------------
  // SINGLE MESSAGE
  // ----------------------------------------------------

  await processSingleMessage(
    message
  );
}

// ======================================================
// TELEGRAM WEBHOOK
// ======================================================

app.post(
  "/webhook",
  async (req, res) => {

    // Respond immediately to Telegram
    // so Telegram doesn't retry unnecessarily.

    res.status(200).send("OK");

    try {

      await handleTelegramUpdate(
        req.body
      );

    } catch (error) {

      console.error(
        "Webhook processing error:",
        error
      );
    }
  }
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  "/",
  (req, res) => {

    res.json({

      status:
        "running",

      service:
        "Telegram Firebase Bot",

      database:
        "sofa/new",

      time:
        new Date().toISOString()
    });
  }
);

// ======================================================
// REFRESH ALL TELEGRAM MEDIA URLS
// ======================================================

async function refreshAllMediaUrls() {

  console.log(
    "===================================="
  );

  console.log(
    "Starting 6-hour media URL refresh..."
  );

  try {

    const snapshot =
      await POSTS_REF.once("value");

    const posts =
      snapshot.val();

    if (!posts) {

      console.log(
        "No posts to refresh."
      );

      return;
    }

    let totalPosts = 0;
    let totalMedia = 0;
    let updatedMedia = 0;

    for (
      const postId of Object.keys(posts)
    ) {

      const post =
        posts[postId];

      totalPosts++;

      if (
        !post.media ||
        !Array.isArray(post.media)
      ) {
        continue;
      }

      let changed = false;

      for (
        let i = 0;
        i < post.media.length;
        i++
      ) {

        const item =
          post.media[i];

        if (!item.file_id) {
          continue;
        }

        totalMedia++;

        try {

          const newUrl =
            await getTelegramFileUrl(
              item.file_id
            );

          if (newUrl) {

            post.media[i].url =
              newUrl;

            post.media[i].url_updated_at =
              Date.now();

            changed = true;

            updatedMedia++;

          }

        } catch (error) {

          console.error(
            "URL refresh failed:",
            item.file_id,
            error.message
          );
        }
      }

      if (changed) {

        await POSTS_REF
          .child(postId)
          .update({

            media:
              post.media,

            last_media_refresh:
              Date.now()
          });
      }
    }

    console.log(
      "6-hour refresh completed."
    );

    console.log(
      "Posts:",
      totalPosts
    );

    console.log(
      "Media:",
      totalMedia
    );

    console.log(
      "URLs updated:",
      updatedMedia
    );

  } catch (error) {

    console.error(
      "Refresh error:",
      error
    );
  }
}

// ======================================================
// REFRESH EVERY 6 HOURS
// ======================================================

const SIX_HOURS =
  6 * 60 * 60 * 1000;

setInterval(
  refreshAllMediaUrls,
  SIX_HOURS
);

// ======================================================
// SERVER START
// ======================================================

app.listen(
  PORT,
  async () => {

    console.log(
      `Server running on port ${PORT}`
    );

    console.log(
      "Firebase path: sofa/new"
    );

    // Refresh existing URLs when server starts.
    await refreshAllMediaUrls();

    // Automatically register webhook
    // if WEBHOOK_URL is supplied.
    if (WEBHOOK_URL) {

      try {

        const webhookUrl =
          `${WEBHOOK_URL.replace(/\/$/, "")}/webhook`;

        const result =
          await telegram(
            "setWebhook",
            {
              url: webhookUrl
            }
          );

        console.log(
          "Telegram webhook registered:",
          result
        );

      } catch (error) {

        console.error(
          "Webhook registration failed:",
          error.message
        );
      }

    } else {

      console.log(
        "WEBHOOK_URL not set."
      );

      console.log(
        "Register the webhook manually."
      );
    }
  }
);
