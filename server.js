const express = require("express");
const path = require("path");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Railway Variables: ustaw MONGO_URL
const MONGO_URL = process.env.MONGO_URL;

// Base64 zdjęcia => duże requesty
app.use(express.json({ limit: "80mb" }));

// Serwuj statycznie pliki z root (index.html, admin.html, favicon, itd.)
app.use(express.static(__dirname, { extensions: ["html"] }));

// ---------- Mongo / Mongoose ----------
if (!MONGO_URL) {
  console.error("❌ Brak MONGO_URL w env (Railway Variables).");
}

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

  // images
  if (!Array.isArray(out.images)) out.images = [];
  out.images = out.images.slice(0, 15).map((x) => String(x));

  out.image = String(out.image || out.images[0] || "");

  // minimalna walidacja (czytelne błędy)
  if (out.title.length < 3) throw new Error("Title too short");
  if (out.city.length < 2) throw new Error("City too short");
  if (!Number.isFinite(out.price) || out.price <= 0) throw new Error("Invalid price");
  if (!Number.isFinite(out.area) || out.area <= 0) throw new Error("Invalid area");
  if (!Number.isFinite(out.rooms) || out.rooms <= 0) throw new Error("Invalid rooms");
  if (out.description.length < 10) throw new Error("Description too short");
  if (!out.type) throw new Error("Type required");

  return out;
}

// ---------- API ----------

// GET all listings
app.get("/api/listings", async (req, res) => {
  try {
    const items = await Listing.find({}).sort({ createdAt: -1 }).lean();

    // ✅ kluczowe: dodaj pole `id`, bo front używa item.id
    const out = items.map((x) => ({ ...x, id: String(x._id) }));

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// GET one listing
app.get("/api/listings/:id", async (req, res) => {
  try {
    const item = await Listing.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json({ ...item, id: String(item._id) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// CREATE listing
app.post("/api/listings", async (req, res) => {
  try {
    const payload = normalizeIncoming(req.body);
    const created = await Listing.create(payload);
    res.status(201).json({ ...created.toObject(), id: String(created._id) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// UPDATE listing
app.put("/api/listings/:id", async (req, res) => {
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

// DELETE listing
app.delete("/api/listings/:id", async (req, res) => {
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
