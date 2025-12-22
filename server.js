const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Railway Variables
const MONGO_URL = process.env.MONGO_URL;
const ADMIN_PIN = String(process.env.ADMIN_PIN || "").trim();          // np. "12345"
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();    // długi losowy sekret

// Jeśli stoisz za proxy (Railway) – potrzebne dla secure cookies
app.set("trust proxy", 1);

// Base64 zdjęcia => duże requesty
app.use(express.json({ limit: "80mb" }));

// Serwuj statycznie pliki z root (index.html, admin.html, favicon, itd.)
app.use(express.static(__dirname, { extensions: ["html"] }));

// ---------- Mongo / Mongoose ----------
if (!MONGO_URL) console.error("❌ Brak MONGO_URL w env (Railway Variables).");

mongoose
  .connect(MONGO_URL || "mongodb://127.0.0.1:27017/centrum")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connect error:", err.message));

const ListingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, minlength: 3 },
    type: { type: String, required: true },
    city: { type: String, required: true, minlength: 2 },

    price: { type: Number, required: true, min: 1 },
    area: { type: Number, required: true, min: 1 },
    rooms: { type: Number, required: true, min: 1 },

    description: { type: String, required: true, minlength: 10 },

    // opcjonalne
    rent: { type: String, default: "" },
    market: { type: String, default: "" },
    finish: { type: String, default: "" },
    floor: { type: mongoose.Schema.Types.Mixed, default: null },
    heating: { type: String, default: "" },
    ownership: { type: String, default: "" },
    featured: { type: Boolean, default: false },

    // zdjęcia (base64 dataURL)
    images: { type: [String], default: [] },
    image: { type: String, default: "" }
  },
  { timestamps: true }
);

ListingSchema.index({ createdAt: -1 });
const Listing = mongoose.model("Listing", ListingSchema);

function normalizeIncoming(body = {}) {
  const out = { ...body };

  out.title = String(out.title || "").trim();
  out.type = String(out.type || "").trim();
  out.city = String(out.city || "").trim();
  out.description = String(out.description || "").trim();

  out.price = Number(out.price);
  out.area = Number(out.area);
  out.rooms = Number(out.rooms);

  out.rent = out.rent ? String(out.rent).trim() : "";
  out.market = out.market ? String(out.market).trim() : "";
  out.finish = out.finish ? String(out.finish).trim() : "";
  out.heating = out.heating ? String(out.heating).trim() : "";
  out.ownership = out.ownership ? String(out.ownership).trim() : "";
  out.featured = !!out.featured;

  if (out.floor === "" || out.floor === undefined) out.floor = null;

  if (!Array.isArray(out.images)) out.images = [];
  out.images = out.images.slice(0, 15).map((x) => String(x));
  out.image = String(out.image || out.images[0] || "");

  if (out.title.length < 3) throw new Error("Title too short");
  if (out.city.length < 2) throw new Error("City too short");
  if (!Number.isFinite(out.price) || out.price <= 0) throw new Error("Invalid price");
  if (!Number.isFinite(out.area) || out.area <= 0) throw new Error("Invalid area");
  if (!Number.isFinite(out.rooms) || out.rooms <= 0) throw new Error("Invalid rooms");
  if (out.description.length < 10) throw new Error("Description too short");
  if (!out.type) throw new Error("Type required");

  return out;
}

// ------------------ ADMIN AUTH (PIN) ------------------
const COOKIE_NAME = "admin_session";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dni

function base64url(bufOrStr) {
  const b = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr));
  return b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64urlToBuffer(b64url) {
  const pad = 4 - (b64url.length % 4 || 4);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function signToken(payloadObj) {
  if (!ADMIN_SECRET) return null;
  const payload = base64url(JSON.stringify(payloadObj));
  const sig = base64url(crypto.createHmac("sha256", ADMIN_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  try {
    if (!ADMIN_SECRET) return { ok: false, reason: "no_secret" };
    if (!token || typeof token !== "string") return { ok: false, reason: "no_token" };
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return { ok: false, reason: "bad_format" };

    const expected = base64url(crypto.createHmac("sha256", ADMIN_SECRET).update(payload).digest());
    if (!safeEqual(sig, expected)) return { ok: false, reason: "bad_sig" };

    const obj = JSON.parse(base64urlToBuffer(payload).toString("utf8"));
    const iat = Number(obj?.iat || 0);
    if (!Number.isFinite(iat)) return { ok: false, reason: "bad_iat" };
    if (Date.now() - iat > TOKEN_TTL_MS) return { ok: false, reason: "expired" };

    return { ok: true, data: obj };
  } catch {
    return { ok: false, reason: "exception" };
  }
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const v = verifyToken(token);
  if (!v.ok) return res.status(401).json({ error: "UNAUTHORIZED" });
  next();
}

// login
app.post("/api/admin/login", (req, res) => {
  const pin = String(req.body?.pin || "").trim();

  if (!/^\d{5}$/.test(pin)) return res.status(400).json({ error: "PIN_INVALID" });
  if (!/^\d{5}$/.test(ADMIN_PIN)) return res.status(500).json({ error: "ADMIN_PIN_NOT_SET" });
  if (!ADMIN_SECRET) return res.status(500).json({ error: "ADMIN_SECRET_NOT_SET" });

  if (!safeEqual(pin, ADMIN_PIN)) return res.status(401).json({ error: "PIN_WRONG" });

  const token = signToken({ iat: Date.now() });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_MS
  });

  res.json({ ok: true });
});

// session check
app.get("/api/admin/me", (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const v = verifyToken(token);
  res.json({ authed: !!v.ok });
});

// logout
app.post("/api/admin/logout", (req, res) => {
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  res.json({ ok: true });
});

// ---------- API ----------

// GET all listings (PUBLIC)
app.get("/api/listings", async (req, res) => {
  try {
    const items = await Listing.find({}).sort({ createdAt: -1 }).lean();
    const out = items.map((x) => ({ ...x, id: String(x._id) }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// GET one listing (PUBLIC)
app.get("/api/listings/:id", async (req, res) => {
  try {
    const item = await Listing.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json({ ...item, id: String(item._id) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// CREATE listing (ADMIN)
app.post("/api/listings", requireAdmin, async (req, res) => {
  try {
    const payload = normalizeIncoming(req.body);
    const created = await Listing.create(payload);
    res.status(201).json({ ...created.toObject(), id: String(created._id) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// UPDATE listing (ADMIN)
app.put("/api/listings/:id", requireAdmin, async (req, res) => {
  try {
    const payload = normalizeIncoming(req.body);
    const updated = await Listing.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ ...updated.toObject(), id: String(updated._id) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// DELETE listing (ADMIN)
app.delete("/api/listings/:id", requireAdmin, async (req, res) => {
  try {
    const deleted = await Listing.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// ---------- Pages ----------
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, () => console.log(`✅ Server listening on ${PORT}`));
