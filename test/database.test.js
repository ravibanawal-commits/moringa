const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDatabase } = require("../database");
const { defaultContent } = require("../server");

const stores = new Map();

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class MemoryCollection {
  constructor(documents) {
    this.documents = documents;
  }

  async createIndex() {}

  async findOne(filter) {
    return clone(this.documents.get(filter._id));
  }

  async countDocuments() {
    return this.documents.size;
  }

  async replaceOne(filter, replacement, { upsert } = {}) {
    if (upsert || this.documents.has(filter._id)) {
      this.documents.set(filter._id, clone(replacement));
    }
  }

  async insertOne(document) {
    if (this.documents.has(document._id)) throw new Error("Duplicate key");
    this.documents.set(document._id, clone(document));
  }

  async deleteOne(filter) {
    const document = this.documents.get(filter._id);
    if (!document) return { deletedCount: 0 };
    for (const [key, value] of Object.entries(filter)) {
      if (key === "_id") continue;
      if (value && value.$gt) {
        if (!(document[key] > value.$gt)) return { deletedCount: 0 };
      } else if (document[key] !== value) {
        return { deletedCount: 0 };
      }
    }
    this.documents.delete(filter._id);
    return { deletedCount: 1 };
  }
}

class MemoryMongoClient {
  constructor() {}

  async connect() {}

  db(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const database = stores.get(name);
    return {
      collection(name) {
        if (!database.has(name)) database.set(name, new Map());
        return new MemoryCollection(database.get(name));
      }
    };
  }

  async close() {}
}

function createTestDatabase(options) {
  return createDatabase({
    uri: "mongodb://memory",
    MongoClientClass: MemoryMongoClient,
    defaultContent,
    ...options
  });
}

test("imports legacy JSON once and persists MongoDB updates", async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "moringa-db-"));
  const content = { ...defaultContent, aboutCopy: "Legacy orchard story." };
  const photo = {
    id: "00000000-0000-4000-8000-000000000001",
    format: "jpeg",
    mimeType: "image/jpeg",
    alt: "Orchard",
    uploadedAt: "2025-01-01T00:00:00.000Z"
  };
  const inquiry = {
    name: "Sam Green",
    phone: "+1 555 123 4567",
    email: "sam@example.com",
    message: "I would like to visit.",
    receivedAt: "2025-01-02T00:00:00.000Z"
  };
  fs.writeFileSync(path.join(dataDirectory, "content.json"), JSON.stringify(content));
  fs.writeFileSync(path.join(dataDirectory, "gallery.json"), JSON.stringify([photo]));
  fs.writeFileSync(path.join(dataDirectory, "inquiries.jsonl"), `${JSON.stringify(inquiry)}\n`);

  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));
  const databaseName = `moringa-${crypto.randomUUID()}`;
  let database = await createTestDatabase({ dataDirectory, databaseName });
  assert.deepEqual(await database.getContent(), content);
  assert.deepEqual(await database.listGallery(), [photo]);
  assert.equal(await database.inquiries.countDocuments(), 1);

  const updatedContent = { ...content, aboutCopy: "Saved in MongoDB." };
  await database.setContent(updatedContent);
  await database.saveInquiry({ ...inquiry, name: "Alex Green" });
  fs.writeFileSync(path.join(dataDirectory, "content.json"), "invalid to ensure no second import");
  await database.close();

  database = await createTestDatabase({ dataDirectory, databaseName });
  assert.deepEqual(await database.getContent(), updatedContent);
  assert.deepEqual(await database.listGallery(), [photo]);
  assert.equal(await database.inquiries.countDocuments(), 2);
  await database.close();
});

test("seeds default content when no legacy data exists", async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "moringa-db-"));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));

  const database = await createTestDatabase({
    dataDirectory,
    databaseName: `moringa-${crypto.randomUUID()}`
  });
  assert.deepEqual(await database.getContent(), defaultContent);
  assert.deepEqual(await database.listGallery(), []);
  await database.close();
});

test("stores admin credentials and consumes only valid, unexpired reset tokens", async (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "moringa-db-"));
  t.after(() => fs.rmSync(dataDirectory, { recursive: true, force: true }));

  const database = await createTestDatabase({
    dataDirectory,
    databaseName: `moringa-${crypto.randomUUID()}`
  });
  const credential = { username: "admin", salt: "salt", hash: "hash", version: 1 };
  await database.setAdminCredential(credential);
  assert.deepEqual(await database.getAdminCredential(), { _id: "admin", ...credential });

  const expiresAt = new Date(Date.now() + 60_000);
  await database.savePasswordReset("hashed-token", expiresAt);
  assert.equal(await database.consumePasswordReset("wrong-token"), false);
  assert.equal(await database.consumePasswordReset("hashed-token", new Date(Date.now() + 120_000)), false);
  assert.equal(await database.consumePasswordReset("hashed-token"), true);
  assert.equal(await database.consumePasswordReset("hashed-token"), false);
  await database.close();
});
