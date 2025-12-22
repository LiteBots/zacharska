const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

// Railway ustawia PORT w zmiennych środowiskowych
const PORT = process.env.PORT || 3000;

// --- Konfiguracja / ENV (na później do auth) ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ""; // później użyjemy
const ADMIN_TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || "change_me"; // później użyjemy

// --- Plik "bazy danych" w root repo ---
const DB_PATH = path.join(__dirname, "db.json");

// Limit JSON (zdjęcia jako base64 potrafią być duże)
app.use(express.json({ limit: "30mb" }));

// Serwuj statycznie wszystko z root (index.html, admin.html, favicon, itd.)
app.use(express.static(__dirname, { extensions: ["html"] }));

/**
 * Model listing (przykład):
 * {
 *   id: "uuid",
 *   createdAt: 123,
 *   updatedAt: 123,
 *   title: "3 pokoje...",
 *   type: "Mieszkanie",
 *   city: "Słupsk",
 *   price: 500000,
 *   area: 65,
 *   rooms: 3,
 *   description: "...",
 *   featured: true,
 *   images: ["data:image/jpeg;base64,...", ...], // max 15
 *   image: "data:image..." // cover
 *   rent, market, finish, floor, heating, ownership
 * }
 */

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { listings: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), "utf-8");
  }
}

function readDb() {
  ensureDb();
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return { listings: [] };
    if (!Array.isArray(parsed.listings)) parsed.listings = [];
    return parsed;
  } catch {
    return { listings: [] };
  }
}

function writeDb(db) {
  // zapis atomowy
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmp, DB_PATH);
}

function normalizeListing(input, { isUpdate = false } = {}) {
  const now = Date.now();

  const out = { ...input };

  // id
  if (!isUpdate) out.id = out.id || crypto.randomUUID();
  if (!out.id || typeof out.id !== "string") throw new Error("Invalid id");

  // timestamps
  if (!isUpdate) out.createdAt = out.createdAt || now;
  out.updatedAt = now;

  // required
  out.title = String(out.title || "").trim();
  out.type = String(out.type || "").trim();
  out.city = String(out.city || "").trim();
  out.description = String(out.description || "").trim();

  out.price = Number(out.price);
  out.area = Number(out.area);
  out.rooms = Number(out.rooms);

  // optional
  out.featured = !!out.featured;

  out.rent = out.rent ? String(out.rent).trim() : "";
  out.market = out.market ? String(out.market).trim() : "";
  out.finish = out.finish ? String(out.finish).trim() : "";
  out.heating = out.heating ? String(out.heating).trim() : "";
  out.ownership = out.ownership ? String(out.ownership).trim() : "";

  if (out.floor === "" || out.floor === undefined) out.floor = null;

  // images
  if (!Array.isArray(out.images)) out.images = [];
  out.images = out.images.slice(0, 15).map((x) => String(x));

  // cover
  out.image = String(out.image || out.images[0] || "");

  // minimalna walidacja (twarda)
  if (out.title.length < 3) throw new Error("Title too short");
  if (out.city.length < 2) throw new Error("City too short");
  if (!Number.isFinite(out.price) || out.price <= 0) throw new Error("Invalid price");
  if (!Number.isFinite(out.area) || out.area <= 0) throw new Error("Invalid area");
  if (!Number.isFinite(out.rooms) || out.rooms <= 0) throw new Error("Invalid rooms");
  if (out.description.length < 10) throw new Error("Description too short");
  if (!out.type) throw new Error("Type required");

  return out;
}

// --- API ---

// GET all listings
app.get("/api/listings", (req, res) => {
  const db = readDb();
  // opcjonalnie sort newest
  const out = [...db.listings].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(out);
});

// GET one
app.get("/api/listings/:id", (req, res) => {
  const db = readDb();
  const item = db.listings.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

// CREATE
app.post("/api/listings", (req, res) => {
  try {
    const db = readDb();
    const item = normalizeListing(req.body, { isUpdate: false });

    // unikaj kolizji
    if (db.listings.some((x) => x.id === item.id)) {
      item.id = crypto.randomUUID();
    }

    db.listings.unshift(item);
    writeDb(db);
    res.status(201).json(item);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// UPDATE
app.put("/api/listings/:id", (req, res) => {
  try {
    const db = readDb();
    const idx = db.listings.findIndex((x) => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Not found" });

    const existing = db.listings[idx];
    const merged = { ...existing, ...req.body, id: existing.id, createdAt: existing.createdAt };
    const item = normalizeListing(merged, { isUpdate: true });

    db.listings[idx] = item;
    writeDb(db);
    res.json(item);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// DELETE
app.delete("/api/listings/:id", (req, res) => {
  const db = readDb();
  const before = db.listings.length;
  db.listings = db.listings.filter((x) => x.id !== req.params.id);
  if (db.listings.length === before) return res.status(404).json({ error: "Not found" });
  writeDb(db);
  res.json({ ok: true });
});

// --- Routing stron (opcjonalnie jawnie) ---
// Jeśli wejdziesz na /admin -> pokaż admin.html
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Root -> index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
