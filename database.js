const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { MongoClient } = require("mongodb");

const MIGRATION_ID = "legacy-database-v1";

async function readLegacyJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function stableLegacyId(index, record) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex");
  return `legacy-inquiry-${index}-${digest}`;
}

async function readLegacyData({ dataDirectory, defaultContent }) {
  const gallery = await readLegacyJson(path.join(dataDirectory, "gallery.json"), []);
  if (!Array.isArray(gallery)) throw new Error("Legacy gallery data must be an array.");

  let inquiries = [];
  try {
    inquiries = (await fs.readFile(path.join(dataDirectory, "inquiries.jsonl"), "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return {
    content: await readLegacyJson(path.join(dataDirectory, "content.json"), defaultContent),
    gallery,
    inquiries: inquiries.map((inquiry, index) => ({
      ...inquiry,
      _id: stableLegacyId(index, inquiry)
    }))
  };
}

class MongoDatabase {
  constructor(db, client) {
    this.client = client;
    this.content = db.collection("site_content");
    this.gallery = db.collection("gallery");
    this.inquiries = db.collection("inquiries");
    this.adminCredentials = db.collection("admin_credentials");
    this.passwordResets = db.collection("password_resets");
    this.migrations = db.collection("schema_migrations");
  }

  async getContent() {
    const document = await this.content.findOne({ _id: "homepage" });
    if (!document) throw new Error("Homepage content is missing from the database.");
    return document.content;
  }

  async setContent(content) {
    await this.content.replaceOne(
      { _id: "homepage" },
      { _id: "homepage", content, updatedAt: new Date().toISOString() },
      { upsert: true }
    );
  }

  async listGallery() {
    const document = await this.gallery.findOne({ _id: "gallery" });
    return document ? document.photos : [];
  }

  async replaceGallery(photos) {
    await this.gallery.replaceOne(
      { _id: "gallery" },
      { _id: "gallery", photos },
      { upsert: true }
    );
  }

  async saveInquiry(inquiry) {
    await this.inquiries.insertOne(inquiry);
  }

  async getAdminCredential() {
    return this.adminCredentials.findOne({ _id: "admin" });
  }

  async setAdminCredential(credential) {
    await this.adminCredentials.replaceOne(
      { _id: "admin" },
      { _id: "admin", ...credential },
      { upsert: true }
    );
  }

  async savePasswordReset(tokenHash, expiresAt) {
    await this.passwordResets.replaceOne(
      { _id: "admin" },
      { _id: "admin", tokenHash, expiresAt },
      { upsert: true }
    );
  }

  async consumePasswordReset(tokenHash, now = new Date()) {
    const result = await this.passwordResets.deleteOne({
      _id: "admin",
      tokenHash,
      expiresAt: { $gt: now }
    });
    return result.deletedCount === 1;
  }

  async removePasswordReset(tokenHash) {
    await this.passwordResets.deleteOne({ _id: "admin", tokenHash });
  }

  async close() {
    await this.client.close();
  }
}

async function createDatabase({
  uri,
  databaseName = "moringa",
  dataDirectory,
  defaultContent,
  MongoClientClass = MongoClient
}) {
  if (!uri) throw new Error("Set MONGODB_URI to connect to MongoDB.");
  await fs.mkdir(dataDirectory, { recursive: true });

  const client = new MongoClientClass(uri);
  try {
    await client.connect();
  } catch (error) {
    await client.close();
    throw error;
  }

  const database = new MongoDatabase(client.db(databaseName), client);
  try {
    await database.inquiries.createIndex({ receivedAt: -1 });
    await database.passwordResets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    const existingContent = await database.content.findOne({ _id: "homepage" });
    const existingGallery = await database.gallery.findOne({ _id: "gallery" });
    const existingInquiries = await database.inquiries.countDocuments();
    const migration = await database.migrations.findOne({ _id: MIGRATION_ID });

    let hasContent = Boolean(existingContent);
    let hasGallery = Boolean(existingGallery);
    const shouldImport = (migration && migration.status === "in_progress")
      || (!migration && !hasContent && !hasGallery && existingInquiries === 0);
    if (shouldImport) {
      if (!migration) {
        await database.migrations.insertOne({
          _id: MIGRATION_ID,
          status: "in_progress",
          startedAt: new Date().toISOString()
        });
      }
      const legacy = await readLegacyData({ dataDirectory, defaultContent });
      await database.setContent(legacy.content);
      await database.replaceGallery(legacy.gallery);
      for (const inquiry of legacy.inquiries) {
        await database.inquiries.replaceOne({ _id: inquiry._id }, inquiry, { upsert: true });
      }
      await database.migrations.replaceOne(
        { _id: MIGRATION_ID },
        { _id: MIGRATION_ID, status: "complete", appliedAt: new Date().toISOString() },
        { upsert: true }
      );
      hasContent = true;
      hasGallery = true;
    }

    if (!hasContent) await database.setContent(defaultContent);
    if (!hasGallery) await database.replaceGallery([]);
    return database;
  } catch (error) {
    await client.close();
    throw error;
  }
}

module.exports = { createDatabase };
