const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { translate } = require("@vitalets/google-translate-api");
const { createDatabase } = require("./database");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const GALLERY_DIR = path.join(DATA_DIR, "gallery");
const SESSION_COOKIE = "moringa_admin";
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const REMEMBERED_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_MAX_AGE = 30 * 60 * 1000;
const CAPTCHA_MAX_AGE = 5 * 60 * 1000;
const CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (error, derivedKey) => {
    if (error) reject(error);
    else resolve(derivedKey);
  });
});
const translationCache = new Map();
const captchaChallenges = new Map();
let translationCooldownUntil = 0;
let database;

const defaultContent = {
  aboutTitle: "A slower way to<br><em>grow something good.</em>",
  aboutCopy: "At Moringa Grove, we believe the best things begin with healthy soil, patient hands, and respect for the seasons. Our orchard brings together moringa trees and a thoughtful approach to growing—so every harvest has a story worth sharing.",
  heroSlides: [
    { image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=2000&q=88", title: "Good things<br>grow <em>here.</em>", caption: "A family-grown moringa orchard, rooted in the land and nurtured with care." },
    { image: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=2000&q=88", title: "Rooted in<br><em>goodness.</em>", caption: "Discover the quiet joy of growing thoughtfully, one season at a time." },
    { image: "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?auto=format&fit=crop&w=2000&q=88", title: "Grown with<br><em>purpose.</em>", caption: "Meet the people and practices behind our little corner of green." }
  ],
  benefits: [
    { icon: "leaf", title: "A leafy addition", description: "Moringa leaves can be enjoyed fresh or dried, bringing a distinctive green note to everyday meals." },
    { icon: "bowl", title: "Made for the kitchen", description: "Stir into soups, blend into smoothies, or steep as a simple herbal tea." },
    { icon: "sun", title: "A naturally versatile plant", description: "From its leaves to its pods, moringa has a long history of practical, culinary uses." },
    { icon: "heart", title: "Part of a balanced life", description: "A flavorful plant food to enjoy alongside a varied diet and healthy daily habits." }
  ]
};

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createCaptchaSvg(code) {
  const noise = Array.from({ length: 5 }, () => {
    const x1 = crypto.randomInt(0, 181);
    const y1 = crypto.randomInt(0, 59);
    const x2 = crypto.randomInt(0, 181);
    const y2 = crypto.randomInt(0, 59);
    return `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
  }).join("");
  const characters = [...code].map((character, index) => {
    const x = 25 + index * 32;
    const y = 39 + crypto.randomInt(-5, 6);
    const angle = crypto.randomInt(-14, 15);
    return `<text x="${x}" y="${y}" transform="rotate(${angle} ${x} ${y})">${character}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="58" viewBox="0 0 180 58"><rect width="180" height="58" rx="6" fill="#f7f6f0"/><g fill="none" stroke="#9aaa83" stroke-width="1" opacity=".55">${noise}</g><g fill="#153d2d" font-family="Arial,sans-serif" font-size="27" font-weight="700" letter-spacing="2">${characters}</g></svg>`;
}

function issueCaptchaChallenge() {
  const now = Date.now();
  for (const [id, challenge] of captchaChallenges) {
    if (challenge.expiresAt <= now) captchaChallenges.delete(id);
  }
  if (captchaChallenges.size >= 1000) {
    captchaChallenges.delete(captchaChallenges.keys().next().value);
  }

  const id = crypto.randomBytes(18).toString("hex");
  const code = Array.from({ length: 5 }, () => CAPTCHA_ALPHABET[crypto.randomInt(CAPTCHA_ALPHABET.length)]).join("");
  captchaChallenges.set(id, { code, svg: createCaptchaSvg(code), expiresAt: now + CAPTCHA_MAX_AGE });
  return id;
}

function consumeCaptchaChallenge(id, code) {
  if (typeof id !== "string") return false;
  const challenge = captchaChallenges.get(id);
  if (!challenge) return false;
  captchaChallenges.delete(id);
  if (challenge.expiresAt <= Date.now()) return false;
  return safeEqual(typeof code === "string" ? code.trim().toUpperCase() : "", challenge.code);
}

function signSession(username, expiresAt = Date.now() + SESSION_MAX_AGE, credentialVersion) {
  const session = { username, expiresAt };
  if (Number.isInteger(credentialVersion)) session.credentialVersion = credentialVersion;
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = cookieValue.slice(0, separator);
  const suppliedSignature = cookieValue.slice(separator + 1);
  const expectedSignature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (!safeEqual(suppliedSignature, expectedSignature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof session.username !== "string" || !Number.isFinite(session.expiresAt) || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function sanitizeHeadline(value, maxLength) {
  return cleanText(value, maxLength)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;(\/?em|br)&gt;/gi, (_match, tag) => `<${tag.toLowerCase()}>`);
}

function sanitizeContent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw validationError("Content must be an object.");
  const aboutTitle = sanitizeHeadline(input.aboutTitle, 160);
  const aboutCopy = cleanText(input.aboutCopy, 1200);
  if (!aboutTitle || !aboutCopy) throw validationError("Add an orchard heading and story before saving.");
  if (!Array.isArray(input.heroSlides) || input.heroSlides.length < 1 || input.heroSlides.length > 5) throw validationError("Add between 1 and 5 featured slides.");
  if (!Array.isArray(input.benefits) || input.benefits.length < 1 || input.benefits.length > 8) throw validationError("Add between 1 and 8 highlights.");
  const heroSlides = input.heroSlides.map((slide) => {
    const image = cleanText(slide && slide.image, 1000);
    let parsed;
    try { parsed = new URL(image); } catch { throw validationError("Each slide needs a valid image URL."); }
    if (!["https:", "http:"].includes(parsed.protocol)) throw validationError("Slide image URLs must use HTTP or HTTPS.");
    const title = sanitizeHeadline(slide && slide.title, 180);
    const caption = cleanText(slide && slide.caption, 240);
    if (!title || !caption) throw validationError("Each slide needs a headline and supporting text.");
    return { image, title, caption };
  });
  const allowedIcons = new Set(["leaf", "bowl", "sun", "heart"]);
  const benefits = input.benefits.map((benefit) => {
    const icon = cleanText(benefit && benefit.icon, 20);
    const title = cleanText(benefit && benefit.title, 80);
    const description = cleanText(benefit && benefit.description, 320);
    if (!allowedIcons.has(icon) || !title || !description) throw validationError("Each highlight needs a supported icon, title, and description.");
    return { icon, title, description };
  });
  return { aboutTitle, aboutCopy, heroSlides, benefits };
}

function validateInquiry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw validationError("Please complete the inquiry form.");
  const name = cleanText(input.name, 120);
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const message = cleanText(input.message, 2000);
  if (!name || !phone || !email || !message) throw validationError("Please complete all required fields.");
  const emailPattern = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  const localPart = email.split("@")[0];
  if (email.length > 254 || localPart.length > 64 || !emailPattern.test(email)) {
    throw validationError("Enter a valid email address.");
  }
  if (!/^[0-9]{10}$/.test(phone)) throw validationError("Enter a 10-digit mobile number.");
  return { name, phone, email, message };
}

function getEmailNotificationStatus(result) {
  if (result.status === "rejected") return "failed";
  if (result.value === "logged") return "logged";
  return result.value === true ? "sent" : "not_configured";
}

function hasSmtpConfiguration() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, ADMIN_EMAIL } = process.env;
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD && SMTP_FROM && ADMIN_EMAIL);
}

function createSmtpTransport(createTransport = nodemailer.createTransport) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) throw new Error("SMTP email is not configured.");
  const port = Number(process.env.SMTP_PORT) || 587;
  return createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD }
  });
}

async function sendPasswordResetEmail(resetUrl, createTransport = nodemailer.createTransport) {
  const { SMTP_FROM, ADMIN_EMAIL } = process.env;
  if (!SMTP_FROM || !ADMIN_EMAIL) throw new Error("Admin password reset email is not configured.");
  const transporter = createSmtpTransport(createTransport);
  try {
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to: ADMIN_EMAIL,
      subject: "Reset your Moringa Grove admin password",
      text: `A password reset was requested for the Moringa Grove admin account.\n\nUse this one-time link within 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`
    });
    if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
      throw new Error("SMTP server did not accept the admin password reset recipient.");
    }
    console.info("Admin password reset email accepted by SMTP relay.", { messageId: info.messageId || "unavailable" });
  } finally {
    transporter.close();
  }
}

function getImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

function getVideoFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") return "mp4";
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "webm";
  return null;
}

const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 5, fields: 0, parts: 5 },
  fileFilter: (req, file, callback) => {
    if (["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"].includes(file.mimetype)) return callback(null, true);
    const error = new Error("Only JPG, PNG, WebP, MP4, or WebM files are supported.");
    error.statusCode = 400;
    callback(error);
  }
});

function publicPhoto(photo) {
  return {
    id: photo.id,
    alt: photo.alt,
    uploadedAt: photo.uploadedAt,
    mediaType: ["mp4", "webm"].includes(photo.format) ? "video" : "image",
    src: `/api/gallery/${photo.id}/media`
  };
}

async function requireAdmin(req, res, next) {
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map((part) => {
    const separator = part.indexOf("=");
    return separator === -1 ? ["", ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([key]) => key));
  const session = readSession(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const credential = await getDatabase().getAdminCredential();
    if (!credential || session.username !== credential.username || session.credentialVersion !== credential.version) {
      return res.status(401).json({ error: "Please sign in to continue." });
    }
    req.admin = session;
    next();
  } catch (error) {
    next(error);
  }
}

function cookieOptions(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge
  };
}

async function createAdminCredential(password, username) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt);
  return {
    username,
    salt: salt.toString("base64url"),
    hash: hash.toString("base64url")
  };
}

async function verifyAdminPassword(password, credential) {
  if (!credential || typeof credential.salt !== "string" || typeof credential.hash !== "string") return false;
  const actual = await scrypt(password, Buffer.from(credential.salt, "base64url"));
  const expected = Buffer.from(credential.hash, "base64url");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function initializeAdminCredential(targetDatabase = getDatabase()) {
  const credential = await targetDatabase.getAdminCredential();
  if (credential) return credential;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return null;
  const initialCredential = await createAdminCredential(password, username);
  const seededCredential = { ...initialCredential, version: 1 };
  await targetDatabase.setAdminCredential(seededCredential);
  return seededCredential;
}

function getDatabase() {
  if (!database) throw new Error("The database has not been initialized.");
  return database;
}

function setDatabaseForTests(value) {
  database = value;
}

async function readContent() {
  return getDatabase().getContent();
}

async function writeContent(content, targetDatabase = getDatabase()) {
  await targetDatabase.setContent(content);
}

async function readGallery() {
  return getDatabase().listGallery();
}

async function writeGallery(photos) {
  await getDatabase().replaceGallery(photos);
}

async function notifyByEmail(inquiry, createTransport = nodemailer.createTransport) {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, ADMIN_EMAIL } = process.env;
  if (process.env.EMAIL_MODE === "log" && process.env.NODE_ENV !== "production") {
    const previews = [
      {
        to: ADMIN_EMAIL || "(not configured)",
        replyTo: inquiry.email,
        subject: "New Moringa Grove website inquiry",
        text: `New website inquiry\n\nName: ${inquiry.name}\nPhone: ${inquiry.phone}\nEmail: ${inquiry.email}\n\nMessage:\n${inquiry.message}`
      },
      {
        to: inquiry.email,
        replyTo: ADMIN_EMAIL || SMTP_FROM || "(not configured)",
        subject: "We received your inquiry — Moringa Grove",
        text: `Hi ${inquiry.name},\n\nThank you for reaching out to Moringa Grove. We’ve received your inquiry and will be in touch soon.\n\nMoringa Grove`
      }
    ];
    console.log("EMAIL MOCK (not sent):", JSON.stringify(previews, null, 2));
    return "logged";
  }
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM || !ADMIN_EMAIL) return false;
  const transporter = createSmtpTransport(createTransport);
  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: ADMIN_EMAIL,
      replyTo: inquiry.email,
      subject: "New Moringa Grove website inquiry",
      text: `New website inquiry\n\nName: ${inquiry.name}\nPhone: ${inquiry.phone}\nEmail: ${inquiry.email}\n\nMessage:\n${inquiry.message}`
    });
    await transporter.sendMail({
      from: SMTP_FROM,
      to: inquiry.email,
      replyTo: ADMIN_EMAIL,
      subject: "We received your inquiry — Moringa Grove",
      text: `Hi ${inquiry.name},\n\nThank you for reaching out to Moringa Grove. We’ve received your inquiry and will be in touch soon.\n\nMoringa Grove`
    });
    return true;
  } finally {
    transporter.close();
  }
}

async function notifyBySms(inquiry) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, OWNER_PHONE } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM || !OWNER_PHONE) return false;
  const body = new URLSearchParams({
    From: TWILIO_FROM,
    To: OWNER_PHONE,
    Body: `New Moringa Grove inquiry from ${inquiry.name} (${inquiry.phone}). Email: ${inquiry.email}.`
  });
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(`SMS provider returned HTTP ${response.status}`);
  return true;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: "Too many failed sign-in attempts. Please wait 15 minutes before trying again." })
});
const captchaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: "Too many CAPTCHA refresh requests. Please wait a few minutes and try again." })
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: "Too many reset requests. Please wait 15 minutes before trying again." })
});
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const inquiryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false });
const galleryUploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
const translationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => translationCooldownUntil > Date.now() ||
    (Array.isArray(req.body && req.body.texts) && translationCache.has(JSON.stringify(req.body.texts))),
  handler: (req, res) => res.status(429).json({ error: "Too many translation requests. Please wait 15 minutes and try again." })
});

async function requestGoogleTranslation(text, retries = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await translate(text, {
      from: "en",
      to: "hi",
      fetchOptions: { signal: controller.signal }
    });
  } catch (error) {
    if (retries > 0 && !error.status && !error.statusCode && error.name !== "AbortError") {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return requestGoogleTranslation(text, retries - 1);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateBatch(texts) {
  if (texts.length === 1) {
    const result = await requestGoogleTranslation(texts[0]);
    return [result.text];
  }

  const requestId = crypto.randomBytes(4).toString("hex").toUpperCase();
  const markers = texts.map((_text, index) => `ZZQXQ${requestId}SEG${String(index).padStart(3, "0")}QXZQZ`);
  const combined = texts.map((text, index) => `${text}\n${markers[index]}`).join("\n\n");
  const result = await requestGoogleTranslation(combined);
  const translatedTexts = [];
  let offset = 0;
  for (const marker of markers) {
    const markerIndex = result.text.indexOf(marker, offset);
    if (markerIndex < 0) {
      const midpoint = Math.ceil(texts.length / 2);
      return [
        ...await translateBatch(texts.slice(0, midpoint)),
        ...await translateBatch(texts.slice(midpoint))
      ];
    }
    translatedTexts.push(result.text.slice(offset, markerIndex).trim());
    offset = markerIndex + marker.length;
  }
  return translatedTexts;
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "32kb" }));

app.post("/api/translate", translationLimiter, async (req, res) => {
  const texts = req.body && req.body.texts;
  if (
    !Array.isArray(texts) ||
    texts.length < 1 ||
    texts.length > 40 ||
    texts.some((text) => typeof text !== "string" || !text.trim() || text.length > 1400) ||
    texts.reduce((total, text) => total + text.length, 0) > 2500
  ) {
    return res.status(400).json({ error: "Send up to 40 short text items for translation." });
  }

  const cacheKey = JSON.stringify(texts);
  const cached = translationCache.get(cacheKey);
  if (cached) return res.json({ texts: cached });
  if (translationCooldownUntil > Date.now()) {
    const retryAfter = Math.ceil((translationCooldownUntil - Date.now()) / 1000);
    return res.set("Retry-After", String(retryAfter)).status(503).json({
      error: `Google Translate is limiting requests. Please wait ${retryAfter} seconds and try again.`
    });
  }

  try {
    const translatedTexts = await translateBatch(texts);
    if (translationCache.size >= 500) translationCache.delete(translationCache.keys().next().value);
    translationCache.set(cacheKey, translatedTexts);
    res.json({ texts: translatedTexts });
  } catch (error) {
    const statusCode = error.status || error.statusCode;
    if (statusCode === 429 || error.name === "TooManyRequestsError") {
      translationCooldownUntil = Date.now() + 60 * 1000;
      console.warn("Google Translate rate-limited this server.");
      return res.set("Retry-After", "60").status(503).json({ error: "Google Translate is limiting requests right now. Please wait a minute and try again." });
    }
    if (error.name === "AbortError") {
      return res.status(504).json({ error: "The translation service took too long to respond. Please try again." });
    }
    if (error.name === "FetchError" || error.code === "ECONNRESET" || error.code === "ENOTFOUND") {
      console.error("Hindi translation service could not be reached:", error.code || error.name);
      return res.status(503).json({ error: "The translation service cannot be reached. Check the server's internet connection and try again." });
    }
    console.error("Hindi translation request failed:", error.name || "Error", statusCode || error.code || "");
    res.status(502).json({ error: "The translation service could not complete this request. Please try again." });
  }
});

app.get("/api/content", async (req, res, next) => {
  try { res.json(await readContent()); } catch (error) { next(error); }
});

app.get("/api/gallery", async (req, res, next) => {
  try {
    const photos = await readGallery();
    res.json({ photos: photos.map(publicPhoto) });
  } catch (error) { next(error); }
});

app.get(["/api/gallery/:id/image", "/api/gallery/:id/media"], async (req, res, next) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).end();
  try {
    const photo = (await readGallery()).find((item) => item.id === req.params.id);
    if (!photo) return res.status(404).end();
    const file = path.join(GALLERY_DIR, `${photo.id}.${photo.format}`);
    res.sendFile(file, {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff"
      }
    }, (error) => {
      if (!error) return;
      if (error.code === "ENOENT" && !res.headersSent) return res.status(404).end();
      next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/session", requireAdmin, (req, res) => res.json({ authenticated: true }));

app.get("/api/admin/captcha", captchaLimiter, (req, res) => {
  const id = issueCaptchaChallenge();
  res.set("Cache-Control", "no-store");
  res.json({ id, imageUrl: `/api/admin/captcha/${id}.svg` });
});

app.get("/api/admin/captcha/:id.svg", (req, res) => {
  const challenge = captchaChallenges.get(req.params.id);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    captchaChallenges.delete(req.params.id);
    return res.status(404).end();
  }
  res.set({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }).type("image/svg+xml").send(challenge.svg);
});

app.post("/api/admin/login", loginLimiter, async (req, res, next) => {
  const { username, password, rememberMe, captchaId, captchaCode } = req.body || {};
  if (!consumeCaptchaChallenge(captchaId, captchaCode)) {
    return res.status(400).json({ error: "The CAPTCHA code is incorrect or expired. Refresh it and try again." });
  }
  try {
    const credential = await getDatabase().getAdminCredential();
    if (!credential) return res.status(503).json({ error: "Admin login is not configured on this server." });
    const passwordMatches = await verifyAdminPassword(typeof password === "string" ? password : "", credential);
    if (
      !safeEqual(username || "", credential.username) ||
      !passwordMatches
    ) {
      return res.status(401).json({ error: "That username or password wasn’t recognized." });
    }
    const maxAge = rememberMe === true ? REMEMBERED_SESSION_MAX_AGE : SESSION_MAX_AGE;
    res.cookie(SESSION_COOKIE, signSession(credential.username, Date.now() + maxAge, credential.version), cookieOptions(maxAge));
    res.json({ authenticated: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/forgot-password", forgotPasswordLimiter, async (req, res, next) => {
  if (!hasSmtpConfiguration()) return res.status(503).json({ error: "Password reset email is not configured on this server." });
  let baseUrl;
  try {
    baseUrl = new URL(process.env.APP_BASE_URL || `http://localhost:${PORT}`);
  } catch {
    return res.status(503).json({ error: "Password reset URL is not configured correctly on this server." });
  }
  if (
    !baseUrl.host ||
    baseUrl.username ||
    baseUrl.password ||
    !["http:", "https:"].includes(baseUrl.protocol) ||
    (process.env.NODE_ENV === "production" && baseUrl.protocol !== "https:")
  ) {
    return res.status(503).json({ error: "Password reset URL must be a public HTTPS address in production." });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const resetUrl = new URL("/admin/reset-password", baseUrl);
  resetUrl.searchParams.set("token", token);
  try {
    await getDatabase().savePasswordReset(tokenHash, new Date(Date.now() + PASSWORD_RESET_MAX_AGE));
    await sendPasswordResetEmail(resetUrl.toString());
    res.json({ message: "If password reset is available, a link has been sent to the admin email. Check Inbox and Spam/Junk." });
  } catch (error) {
    try {
      await getDatabase().removePasswordReset(tokenHash);
    } catch (cleanupError) {
      console.error("Could not remove an unsent password reset token:", cleanupError);
    }
    next(error);
  }
});

app.post("/api/admin/reset-password", resetPasswordLimiter, async (req, res, next) => {
  const { token, password } = req.body || {};
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return res.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: "Choose a password between 12 and 128 characters." });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const didConsume = await getDatabase().consumePasswordReset(tokenHash);
    if (!didConsume) return res.status(400).json({ error: "This password reset link is invalid or expired. Request a new one." });
    const credential = await getDatabase().getAdminCredential();
    if (!credential) return res.status(503).json({ error: "Admin login is not configured on this server." });
    const passwordCredential = await createAdminCredential(password, credential.username);
    await getDatabase().setAdminCredential({
      ...passwordCredential,
      version: (credential.version || 0) + 1
    });
    res.json({ message: "Password updated. Sign in with your new password." });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({ authenticated: false });
});

app.get("/admin/reset-password", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/api/admin/content", requireAdmin, async (req, res, next) => {
  try { res.json(await readContent()); } catch (error) { next(error); }
});

app.get("/api/admin/gallery", requireAdmin, async (req, res, next) => {
  try {
    const photos = await readGallery();
    res.json({ photos: photos.map(publicPhoto) });
  } catch (error) { next(error); }
});

app.post("/api/admin/gallery", requireAdmin, galleryUploadLimiter, galleryUpload.array("photos", 5), async (req, res, next) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "Choose at least one gallery file to upload." });
  if (files.filter((file) => file.mimetype.startsWith("video/")).length > 1) {
    return res.status(400).json({ error: "Upload one video clip at a time." });
  }
  const savedFiles = [];
  try {
    const existing = await readGallery();
    if (existing.length + files.length > 100) return res.status(400).json({ error: "The gallery can contain up to 100 items." });
    await fs.mkdir(GALLERY_DIR, { recursive: true });
    const created = [];
    for (const file of files) {
      const expectedFormat = {
        "image/jpeg": "jpeg",
        "image/png": "png",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/webm": "webm"
      }[file.mimetype];
      const format = file.mimetype.startsWith("video/")
        ? getVideoFormat(file.buffer)
        : getImageFormat(file.buffer);
      const sizeLimit = file.mimetype.startsWith("video/") ? 25 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > sizeLimit) {
        const error = new Error(file.mimetype.startsWith("video/")
          ? "Each video clip must be 25 MB or smaller."
          : "Each photo must be 5 MB or smaller.");
        error.statusCode = 400;
        throw error;
      }
      if (!format || format !== expectedFormat) {
        const error = new Error("A selected file does not match its JPG, PNG, WebP, MP4, or WebM type.");
        error.statusCode = 400;
        throw error;
      }
      const id = crypto.randomUUID();
      const filePath = path.join(GALLERY_DIR, `${id}.${format}`);
      await fs.writeFile(filePath, file.buffer, { flag: "wx", mode: 0o644 });
      savedFiles.push(filePath);
      const name = path.basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-z0-9 _.-]/gi, "")
        .replace(/[_-]+/g, " ")
        .trim();
      created.push({
        id,
        format,
        mimeType: file.mimetype,
        alt: cleanText(name, 120) || "Moringa orchard photo",
        uploadedAt: new Date().toISOString()
      });
    }
    await writeGallery([...created, ...existing]);
    res.status(201).json({ photos: created.map(publicPhoto) });
  } catch (error) {
    await Promise.all(savedFiles.map(async (filePath) => {
      try { await fs.unlink(filePath); } catch (cleanupError) { console.error("Could not clean up an incomplete gallery upload:", cleanupError); }
    }));
    next(error);
  }
});

app.delete("/api/admin/gallery/:id", requireAdmin, async (req, res, next) => {
  try {
    const photos = await readGallery();
    const photo = photos.find((item) => item.id === req.params.id);
    if (!photo) return res.status(404).json({ error: "That gallery photo was not found." });
    await writeGallery(photos.filter((item) => item.id !== photo.id));
    await fs.rm(path.join(GALLERY_DIR, `${photo.id}.${photo.format}`), { force: true });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

app.get(["/admin", "/admin/"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.put("/api/admin/content", requireAdmin, async (req, res, next) => {
  try {
    const content = sanitizeContent(req.body);
    await writeContent(content);
    res.json({ saved: true });
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ error: "The submitted content is not valid JSON." });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.post("/api/inquiries", inquiryLimiter, async (req, res, next) => {
  try {
    if (cleanText(req.body && req.body.website, 200)) return res.status(202).json({ received: true });
    const inquiry = validateInquiry(req.body);
    const record = { ...inquiry, receivedAt: new Date().toISOString() };
    await getDatabase().saveInquiry(record);
    const notifications = await Promise.allSettled([notifyByEmail(inquiry), notifyBySms(inquiry)]);
    const emailSent = notifications[0].status === "fulfilled" && notifications[0].value === true;
    const smsSent = notifications[1].status === "fulfilled" && notifications[1].value;
    notifications.forEach((result, index) => {
      if (result.status === "rejected") console.error(`${index === 0 ? "Email" : "SMS"} notification failed:`, result.reason);
    });
    res.status(201).json({
      received: true,
      notification: emailSent ? "sent" : "saved",
      emailStatus: getEmailNotificationStatus(notifications[0]),
      smsSent
    });
  } catch (error) {
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (path.extname(filePath).toLowerCase() === ".avif") res.set("Content-Type", "image/avif");
  }
}));

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "A selected file exceeds its size limit (5 MB for photos, 25 MB for videos)."
      : error.code === "LIMIT_FILE_COUNT"
        ? "Upload up to 5 gallery files at a time."
        : "The gallery upload was not accepted.";
    return res.status(400).json({ error: message });
  }
  if (error.statusCode === 400) return res.status(400).json({ error: error.message });
  console.error("Request failed:", error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "Something went wrong on our end. Please try again shortly." });
});

async function start() {
  if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32)) {
    throw new Error("Set SESSION_SECRET to a random value of at least 32 characters before running in production.");
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!database) database = await createDatabase({
    uri: process.env.MONGODB_URI,
    databaseName: process.env.MONGODB_DATABASE || "moringa",
    dataDirectory: DATA_DIR,
    defaultContent
  });
  await initializeAdminCredential();
  await readContent();
  if (!await getDatabase().getAdminCredential()) {
    console.warn("Admin access is disabled until ADMIN_USERNAME and ADMIN_PASSWORD are configured.");
  }
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
    console.warn("SESSION_SECRET is unset; active admin sessions will not survive a server restart.");
  }
  return app.listen(PORT, () => console.log(`Moringa Grove is running on http://localhost:${PORT}`));
}

if (require.main === module) {
  start().catch((error) => { console.error("Could not start server:", error); process.exitCode = 1; });
}

module.exports = {
  app,
  start,
  defaultContent,
  sanitizeContent,
  validateInquiry,
  signSession,
  readSession,
  createAdminCredential,
  verifyAdminPassword,
  initializeAdminCredential,
  setDatabaseForTests,
  getImageFormat,
  getVideoFormat,
  getEmailNotificationStatus,
  notifyByEmail,
  sendPasswordResetEmail,
  writeContent
};
