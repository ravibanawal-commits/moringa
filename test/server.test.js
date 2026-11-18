const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const {
  app,
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
  notifyByEmail
} = require("../server");

function createAuthDatabase(credential) {
  return {
    credential,
    passwordReset: null,
    async getAdminCredential() {
      return this.credential;
    },
    async setAdminCredential(value) {
      this.credential = value;
    },
    async savePasswordReset(tokenHash, expiresAt) {
      this.passwordReset = { tokenHash, expiresAt };
    },
    async consumePasswordReset(tokenHash, now = new Date()) {
      if (!this.passwordReset || this.passwordReset.tokenHash !== tokenHash || this.passwordReset.expiresAt <= now) return false;
      this.passwordReset = null;
      return true;
    },
    async removePasswordReset(tokenHash) {
      if (this.passwordReset && this.passwordReset.tokenHash === tokenHash) this.passwordReset = null;
    }
  };
}

async function getCaptcha(adminApiUrl) {
  const response = await fetch(`${adminApiUrl}/captcha`);
  assert.equal(response.status, 200);
  const challenge = await response.json();
  assert.deepEqual(Object.keys(challenge).sort(), ["id", "imageUrl"]);
  const imageResponse = await fetch(new URL(challenge.imageUrl, adminApiUrl));
  assert.equal(imageResponse.status, 200);
  const svg = await imageResponse.text();
  const code = [...svg.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((match) => match[1]).join("");
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  return { captchaId: challenge.id, captchaCode: code };
}

test("default homepage content passes CMS validation", () => {
  const sanitized = sanitizeContent(defaultContent);
  assert.equal(sanitized.heroSlides.length, 3);
  assert.equal(sanitized.benefits.length, 4);
});

test("CMS content rejects unsafe image schemes and escapes unsupported headline markup", () => {
  const javascriptImage = structuredClone(defaultContent);
  javascriptImage.heroSlides[0].image = "javascript:alert(1)";
  assert.throws(() => sanitizeContent(javascriptImage), /HTTP or HTTPS/);

  const scriptHeading = structuredClone(defaultContent);
  scriptHeading.heroSlides[0].title = '<img src=x onerror="alert(1)">';
  assert.equal(sanitizeContent(scriptHeading).heroSlides[0].title.includes("<img"), false);
  assert.equal(sanitizeContent(defaultContent).heroSlides[0].title.includes("<em>"), true);
});

test("inquiry validator accepts complete details and rejects invalid email", () => {
  const inquiry = validateInquiry({
    name: "Sam Green",
    phone: "5551234567",
    email: "SAM.Green+tag@example.com",
    message: "I would like to learn about your orchard."
  });
  assert.equal(inquiry.email, "sam.green+tag@example.com");
  assert.throws(() => validateInquiry({
    name: "Sam Green",
    phone: "5551234567",
    email: "not-an-email",
    message: "Hello"
  }), /valid email/);
  assert.throws(() => validateInquiry({
    name: "Sam Green",
    phone: "5551234567",
    email: "attacker@example.com,other@example.com",
    message: "Hello"
  }), /valid email/);
  for (const email of [".start@example.com", "ends.@example.com", "double..dot@example.com", "user@example", "user@-example.com"]) {
    assert.throws(() => validateInquiry({
      name: "Sam Green",
      phone: "5551234567",
      email,
      message: "Hello"
    }), /valid email/);
  }
});

test("inquiry validator only accepts exactly 10 mobile-number digits", () => {
  const inquiry = {
    name: "Sam Green",
    phone: "5551234567",
    email: "sam@example.com",
    message: "I would like to learn about your orchard."
  };
  assert.equal(validateInquiry(inquiry).phone, inquiry.phone);
  for (const phone of ["123456789", "12345678901", "+911234567890", "12345abc90", "12345 67890"]) {
    assert.throws(() => validateInquiry({ ...inquiry, phone }), /10-digit mobile number/);
  }
});

test("admin session signatures are verified and expire", () => {
  const token = signSession("orchard-admin");
  assert.equal(readSession(token).username, "orchard-admin");
  assert.equal(readSession(signSession("orchard-admin", Date.now() + 1000, 3)).credentialVersion, 3);
  assert.equal(readSession(`${token.slice(0, -1)}x`), null);
  assert.equal(readSession(signSession("orchard-admin", Date.now() - 1)), null);
});

test("admin login requires a fresh, one-time CAPTCHA code", async (t) => {
  const credential = { ...await createAdminCredential("test-password", "test-admin"), version: 1 };
  setDatabaseForTests(createAuthDatabase(credential));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => {
    server.close(() => {
      setDatabaseForTests(null);
      resolve();
    });
  }));
  const adminApiUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
  const captcha = await getCaptcha(adminApiUrl);

  const invalidResponse = await fetch(`${adminApiUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "test-password", ...captcha, captchaCode: "00000" })
  });
  assert.equal(invalidResponse.status, 400);

  const replayResponse = await fetch(`${adminApiUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "test-password", ...captcha })
  });
  assert.equal(replayResponse.status, 400);

  const validCaptcha = await getCaptcha(adminApiUrl);
  const loginResponse = await fetch(`${adminApiUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "test-password", ...validCaptcha })
  });
  assert.equal(loginResponse.status, 200);
});

test("successful admin logins do not consume the failed-attempt limit", async (t) => {
  const credential = { ...await createAdminCredential("test-password", "test-admin"), version: 1 };
  setDatabaseForTests(createAuthDatabase(credential));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => {
    server.close(() => {
      setDatabaseForTests(null);
      resolve();
    });
  }));
  const adminApiUrl = `http://127.0.0.1:${server.address().port}/api/admin`;

  for (let attempt = 0; attempt < 9; attempt += 1) {
    const captcha = await getCaptcha(adminApiUrl);
    const response = await fetch(`${adminApiUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test-admin", password: "test-password", ...captcha })
    });
    assert.equal(response.status, 200);
  }

  const captcha = await getCaptcha(adminApiUrl);
  const failedResponse = await fetch(`${adminApiUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "wrong-password", ...captcha })
  });
  assert.equal(failedResponse.status, 401);
});

test("admin can reset the MongoDB password with a one-time email link and remember a session", async (t) => {
  const keys = ["NODE_ENV", "APP_BASE_URL", "ADMIN_EMAIL", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalCreateTransport = nodemailer.createTransport;
  const messages = [];
  const database = createAuthDatabase({
    ...await createAdminCredential("old-admin-password", "test-admin"),
    version: 1
  });
  process.env.NODE_ENV = "development";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASSWORD = "smtp-password";
  process.env.SMTP_FROM = "owner@example.com";
  nodemailer.createTransport = () => ({
    async sendMail(message) {
      messages.push(message);
      return { accepted: ["admin@example.com"], messageId: "test-message-id" };
    },
    close() {}
  });
  setDatabaseForTests(database);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => {
    server.close(() => {
      nodemailer.createTransport = originalCreateTransport;
      setDatabaseForTests(null);
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      resolve();
    });
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/admin`;
  const resetPageResponse = await fetch(`http://127.0.0.1:${server.address().port}/admin/reset-password`);
  assert.equal(resetPageResponse.status, 200);
  assert.equal(resetPageResponse.headers.get("cache-control"), "no-store");
  assert.match(await resetPageResponse.text(), /id="reset-form"/);

  const captcha = await getCaptcha(baseUrl);
  const oldLogin = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "old-admin-password", ...captcha })
  });
  assert.equal(oldLogin.status, 200);
  const oldCookie = oldLogin.headers.get("set-cookie").split(";")[0];

  const forgotResponse = await fetch(`${baseUrl}/forgot-password`, { method: "POST" });
  assert.equal(forgotResponse.status, 200);
  assert.equal(messages.length, 1);
  const resetUrl = messages[0].text.match(/https?:\/\/\S+/)[0];
  const token = new URL(resetUrl).searchParams.get("token");
  assert.equal(database.passwordReset.tokenHash.includes(token), false);

  const resetResponse = await fetch(`${baseUrl}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "new-admin-password-2026" })
  });
  assert.equal(resetResponse.status, 200);
  assert.equal(await verifyAdminPassword("old-admin-password", database.credential), false);
  assert.equal(await verifyAdminPassword("new-admin-password-2026", database.credential), true);
  assert.equal(database.credential.version, 2);
  await initializeAdminCredential(database);
  assert.equal(await verifyAdminPassword("new-admin-password-2026", database.credential), true);

  const reusedTokenResponse = await fetch(`${baseUrl}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "another-admin-password-2026" })
  });
  assert.equal(reusedTokenResponse.status, 400);

  const oldSessionResponse = await fetch(`${baseUrl}/session`, { headers: { Cookie: oldCookie } });
  assert.equal(oldSessionResponse.status, 401);
  const newCaptcha = await getCaptcha(baseUrl);
  const newLogin = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test-admin", password: "new-admin-password-2026", rememberMe: true, ...newCaptcha })
  });
  assert.equal(newLogin.status, 200);
  const session = readSession(newLogin.headers.get("set-cookie").split(";")[0].split("=")[1]);
  assert.ok(session.expiresAt > Date.now() + 29 * 24 * 60 * 60 * 1000);
});

test("gallery upload format detection accepts supported image signatures only", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");
  assert.equal(getImageFormat(png), "png");
  assert.equal(getImageFormat(jpeg), "jpeg");
  assert.equal(getImageFormat(webp), "webp");
  assert.equal(getImageFormat(Buffer.from("not an image")), null);
});

test("gallery video format detection accepts MP4 and WebM signatures only", () => {
  const mp4 = Buffer.alloc(12);
  mp4.write("ftyp", 4, "ascii");
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
  assert.equal(getVideoFormat(mp4), "mp4");
  assert.equal(getVideoFormat(webm), "webm");
  assert.equal(getVideoFormat(Buffer.from("not a video")), null);
});

test("chatbot pages load the supplied assistant avatar", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const [avatar, askPage, widgetScript] = await Promise.all([
    fetch(`${origin}/assistant-avatar.avif`),
    fetch(`${origin}/ask`),
    fetch(`${origin}/assistant-widget.js`)
  ]);
  assert.equal(avatar.status, 200);
  assert.match(avatar.headers.get("content-type"), /image\/avif/);
  assert.match(await askPage.text(), /class="chat-avatar" src="\/assistant-avatar\.avif"/);
  assert.match(await widgetScript.text(), /assistant-avatar\.avif/);
});

test("inquiry email status distinguishes sent, unconfigured, and failed notifications", () => {
  assert.equal(getEmailNotificationStatus({ status: "fulfilled", value: true }), "sent");
  assert.equal(getEmailNotificationStatus({ status: "fulfilled", value: "logged" }), "logged");
  assert.equal(getEmailNotificationStatus({ status: "fulfilled", value: false }), "not_configured");
  assert.equal(getEmailNotificationStatus({ status: "rejected", reason: new Error("SMTP failed") }), "failed");
});

test("inquiry email notifies the admin and sends a confirmation to the sender", async () => {
  const keys = ["EMAIL_MODE", "NODE_ENV", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "ADMIN_EMAIL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const messages = [];
  let transportOptions;
  let transportClosed = false;
  const inquiry = {
    name: "Sam Green",
    phone: "5551234567",
    email: "sam@example.com",
    message: "I would like to visit."
  };
  try {
    process.env.EMAIL_MODE = "";
    process.env.NODE_ENV = "development";
    process.env.SMTP_HOST = "smtp.gmail.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = "owner@example.com";
    process.env.SMTP_PASSWORD = "test-app-password";
    process.env.SMTP_FROM = "owner@example.com";
    process.env.ADMIN_EMAIL = "admin@example.com";

    const result = await notifyByEmail(inquiry, (options) => {
      transportOptions = options;
      return {
        async sendMail(message) {
          messages.push(message);
        },
        close() {
          transportClosed = true;
        }
      };
    });

    assert.equal(result, true);
    assert.equal(transportOptions.host, "smtp.gmail.com");
    assert.equal(transportOptions.secure, false);
    assert.deepEqual(messages.map(({ to }) => to), ["admin@example.com", "sam@example.com"]);
    assert.equal(messages[0].replyTo, "sam@example.com");
    assert.equal(messages[1].replyTo, "admin@example.com");
    assert.match(messages[1].subject, /received your inquiry/i);
    assert.match(messages[1].text, /will be in touch soon/i);
    assert.equal(transportClosed, true);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("inquiry email can be previewed in log mode without SMTP credentials", async () => {
  const keys = ["EMAIL_MODE", "NODE_ENV", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "ADMIN_EMAIL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalLog = console.log;
  const logs = [];
  try {
    process.env.EMAIL_MODE = "log";
    process.env.NODE_ENV = "development";
    for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "ADMIN_EMAIL"]) delete process.env[key];
    console.log = (...args) => logs.push(args.join(" "));

    const result = await notifyByEmail({
      name: "Sam Green",
      phone: "5551234567",
      email: "sam@example.com",
      message: "Testing the inquiry preview."
    });

    assert.equal(result, "logged");
    assert.match(logs.join("\n"), /EMAIL MOCK \(not sent\)/);
    assert.match(logs.join("\n"), /Testing the inquiry preview\./);
    assert.match(logs.join("\n"), /We received your inquiry/);
  } finally {
    console.log = originalLog;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("translation API rejects invalid batches without calling the provider", async (t) => {
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/translate`;

  for (const texts of [[], [""], Array(41).fill("hello"), ["x".repeat(1401)]]) {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts })
    });
    assert.equal(response.status, 400);
  }
});
