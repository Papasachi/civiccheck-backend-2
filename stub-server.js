#!/usr/bin/env node
/**
 * CivicCheck — Offline Stub Server
 * Zero external dependencies. Pure Node.js built-ins only.
 * Mirrors every live endpoint so you can test all routes before deploying.
 */

const http = require("http");
const { v4: uuidv4 } = (() => {
  // Tiny UUID v4 — no package needed
  const uuidv4 = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  return { v4: uuidv4 };
})();

const PORT = parseInt(process.env.PORT || "4000", 10);

// ─── In-memory data stores ────────────────────────────────────────────────────
const REPORTS = [
  { id: uuidv4(), title: "Pothole on Main St", description: "Deep pothole near intersection", category: "infrastructure", status: "pending", submittedBy: "user-1", createdAt: daysAgo(1) },
  { id: uuidv4(), title: "Broken streetlight", description: "Light out since Monday", category: "lighting", status: "in_progress", submittedBy: "user-2", createdAt: daysAgo(3) },
  { id: uuidv4(), title: "Illegal dumping", description: "Trash pile behind community centre", category: "sanitation", status: "resolved", submittedBy: "user-1", createdAt: daysAgo(5) },
];

const VAULT_FILES = [
  { fileId: uuidv4(), name: "evidence-photo.jpg", mimeType: "image/jpeg", sizeBytes: 204800, url: "https://mock-storage/evidence-photo.jpg", uploadedBy: "user-1", uploadedAt: daysAgo(2) },
];

const MAP_LOCATIONS = [
  { id: uuidv4(), name: "Pothole — Oak Ave", description: "Large pothole", latitude: 40.7128, longitude: -74.0060, tags: ["pothole", "road"], status: "open", createdBy: "user-1", createdAt: daysAgo(1) },
  { id: uuidv4(), name: "Broken bench — Riverside Park", description: "Bench needs repair", latitude: 40.7218, longitude: -74.0040, tags: ["parks"], status: "in_progress", createdBy: "user-2", createdAt: daysAgo(4) },
  { id: uuidv4(), name: "Graffiti — Station underpass", description: "Graffiti on north wall", latitude: 40.7050, longitude: -74.0090, tags: ["vandalism"], status: "resolved", createdBy: "user-1", createdAt: daysAgo(6) },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDate(d) { return (d instanceof Date ? d : new Date(d)).toISOString(); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  const buf = Buffer.from(json, "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": buf.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Filename",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  res.end(buf);
}

function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}

function mockAuth(req) {
  // In offline mode we accept any Bearer token and return a fake user.
  // In production this is replaced by Firebase Admin token verification.
  const header = req.headers["authorization"] || "";
  if (!header.startsWith("Bearer ")) return null;
  return { uid: "user-1", email: "dev@civiccheck.app", name: "Dev User" };
}

function log(method, path, status) {
  const colours = { 2: "\x1b[32m", 4: "\x1b[33m", 5: "\x1b[31m" };
  const c = colours[String(status)[0]] || "\x1b[0m";
  console.log(`  ${c}${status}\x1b[0m  ${method.padEnd(7)} ${path}`);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

function handleHealth(req, res) {
  send(res, 200, { status: "ok", version: "1.0.0-offline", environment: "offline-stub", timestamp: new Date().toISOString() });
}

function handleHomeStatus(req, res) {
  const user = mockAuth(req);
  const latestReports = [...REPORTS]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 3)
    .map((r) => ({ ...r, createdAt: isoDate(r.createdAt) }));

  send(res, 200, {
    message: user ? `Welcome back, ${user.name} 👋` : "Welcome to CivicCheck 🚀",
    stats: { totalReports: REPORTS.length },
    latestReports,
    _stub: "offline mode — data is in-memory",
  });
}

function handleTrackerData(req, res) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised", message: "Missing Bearer token" });

  const qs = parseQuery(req.url);
  const targetDate = qs.date ? new Date(qs.date) : new Date();
  targetDate.setHours(23, 59, 59, 999);

  const sevenDaysAgo = new Date(targetDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  // Build day buckets
  const buckets = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i);
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const key = d.toISOString().split("T")[0];
    buckets[key] = { label, value: 0, date: key };
  }

  // Seed with mock data + real in-memory reports
  const allReports = [
    ...REPORTS,
    { createdAt: daysAgo(0) }, { createdAt: daysAgo(0) },
    { createdAt: daysAgo(1) }, { createdAt: daysAgo(2) },
    { createdAt: daysAgo(2) }, { createdAt: daysAgo(4) },
  ];

  allReports.forEach((r) => {
    const key = new Date(r.createdAt).toISOString().split("T")[0];
    if (buckets[key]) buckets[key].value += 1;
  });

  const chartData = Object.values(buckets);
  send(res, 200, {
    date: targetDate.toISOString().split("T")[0],
    totalReports: chartData.reduce((s, b) => s + b.value, 0),
    chartData,
  });
}

async function handleTrackerReport(req, res) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised" });

  const body = await readBody(req);
  if (!body.title || !body.description) {
    return send(res, 400, { error: "title and description are required" });
  }

  const newReport = {
    id: uuidv4(),
    title: body.title,
    description: body.description,
    category: body.category || "general",
    location: body.location || null,
    submittedBy: user.uid,
    status: "pending",
    createdAt: new Date(),
  };
  REPORTS.push(newReport);
  send(res, 201, { id: newReport.id, status: "pending" });
}

function handleVaultFiles(req, res) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised" });

  const files = VAULT_FILES
    .filter((f) => f.uploadedBy === user.uid)
    .map((f) => ({ ...f, uploadedAt: isoDate(f.uploadedAt) }));

  send(res, 200, files);
}

async function handleVaultUpload(req, res) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised" });

  // In offline mode we can't parse multipart, so we simulate a successful upload
  const fileName = req.headers["x-filename"] || "uploaded-file.jpg";
  const fileId = uuidv4();
  const now = new Date();

  const newFile = {
    fileId,
    name: fileName,
    mimeType: req.headers["content-type"] || "application/octet-stream",
    sizeBytes: parseInt(req.headers["content-length"] || "0", 10),
    url: `https://mock-storage/vault/${user.uid}/${fileId}`,
    uploadedBy: user.uid,
    uploadedAt: now,
  };
  VAULT_FILES.push(newFile);

  send(res, 200, {
    fileId,
    status: "uploaded",
    name: fileName,
    url: newFile.url,
    uploadedAt: isoDate(now),
    _stub: "offline mode — file not actually stored",
  });
}

async function handleVaultDelete(req, res, fileId) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised" });

  const idx = VAULT_FILES.findIndex((f) => f.fileId === fileId && f.uploadedBy === user.uid);
  if (idx === -1) return send(res, 404, { error: "File not found or not yours" });

  VAULT_FILES.splice(idx, 1);
  send(res, 200, { fileId, deleted: true });
}

function handleMapLocations(req, res) {
  const qs = parseQuery(req.url);
  let locations = MAP_LOCATIONS.map((l) => ({ ...l, createdAt: isoDate(l.createdAt) }));

  if (qs.tag) locations = locations.filter((l) => l.tags.includes(qs.tag));

  if (qs.lat && qs.lng && qs.radiusKm) {
    const lat = parseFloat(qs.lat), lng = parseFloat(qs.lng), delta = parseFloat(qs.radiusKm) / 111;
    locations = locations.filter((l) => Math.abs(l.latitude - lat) <= delta && Math.abs(l.longitude - lng) <= delta);
  }

  send(res, 200, locations);
}

async function handleMapCreate(req, res) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised" });

  const body = await readBody(req);
  if (!body.name || body.latitude == null || body.longitude == null) {
    return send(res, 400, { error: "name, latitude, and longitude are required" });
  }

  const loc = {
    id: uuidv4(),
    name: body.name,
    description: body.description || "",
    latitude: parseFloat(body.latitude),
    longitude: parseFloat(body.longitude),
    tags: Array.isArray(body.tags) ? body.tags : [],
    status: "open",
    createdBy: user.uid,
    createdAt: new Date(),
  };
  MAP_LOCATIONS.push(loc);
  send(res, 201, { ...loc, createdAt: isoDate(loc.createdAt) });
}

async function handleMapPatch(req, res, id) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised" });

  const idx = MAP_LOCATIONS.findIndex((l) => l.id === id);
  if (idx === -1) return send(res, 404, { error: "Location not found" });

  const body = await readBody(req);
  const valid = ["open", "in_progress", "resolved"];
  if (body.status && !valid.includes(body.status)) {
    return send(res, 400, { error: `status must be one of: ${valid.join(", ")}` });
  }

  const loc = MAP_LOCATIONS[idx];
  if (body.status) loc.status = body.status;
  if (body.name) loc.name = body.name;
  if (body.description !== undefined) loc.description = body.description;
  if (body.tags) loc.tags = body.tags;
  loc.updatedAt = new Date();

  send(res, 200, { ...loc, createdAt: isoDate(loc.createdAt), updatedAt: isoDate(loc.updatedAt) });
}

async function handleMapDelete(req, res, id) {
  const user = mockAuth(req);
  if (!user) return send(res, 401, { error: "Unauthorised" });

  const idx = MAP_LOCATIONS.findIndex((l) => l.id === id && l.createdBy === user.uid);
  if (idx === -1) return send(res, 404, { error: "Location not found or not yours" });

  MAP_LOCATIONS.splice(idx, 1);
  send(res, 200, { id, deleted: true });
}

// ─── Router ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const method = req.method;
  const path = req.url.split("?")[0];

  // OPTIONS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Filename",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    });
    res.end();
    log(method, path, 204);
    return;
  }

  const mapLocMatch = path.match(/^\/map\/locations\/([^/]+)$/);

  try {
    if (method === "GET"  && path === "/health")              { handleHealth(req, res); }
    else if (method === "GET"  && path === "/home/status")   { handleHomeStatus(req, res); }
    else if (method === "GET"  && path === "/tracker/data")  { handleTrackerData(req, res); }
    else if (method === "POST" && path === "/tracker/report"){ await handleTrackerReport(req, res); }
    else if (method === "GET"  && path === "/vault/files")   { handleVaultFiles(req, res); }
    else if (method === "POST" && path === "/vault/upload")  { await handleVaultUpload(req, res); }
    else if (method === "DELETE" && path.startsWith("/vault/files/")) {
      const fileId = path.split("/vault/files/")[1];
      await handleVaultDelete(req, res, fileId);
    }
    else if (method === "GET"  && path === "/map/locations") { handleMapLocations(req, res); }
    else if (method === "POST" && path === "/map/locations") { await handleMapCreate(req, res); }
    else if (mapLocMatch && method === "PATCH")  { await handleMapPatch(req, res, mapLocMatch[1]); }
    else if (mapLocMatch && method === "DELETE") { await handleMapDelete(req, res, mapLocMatch[1]); }
    else {
      send(res, 404, { error: "Not found", path, hint: "Available: /health /home/status /tracker/data /tracker/report /vault/upload /vault/files /map/locations" });
    }
  } catch (err) {
    console.error("Error:", err.message);
    send(res, 500, { error: "Internal server error", message: err.message });
  }

  log(method, path, res.statusCode);
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log("\n\x1b[1m\x1b[36m  CivicCheck — Offline Stub Server\x1b[0m");
  console.log("  ─────────────────────────────────");
  console.log(`  🚀  Listening on http://localhost:${PORT}`);
  console.log("  📦  Mode: offline (in-memory, zero dependencies)");
  console.log("\n  Routes:");
  console.log("    GET  /health");
  console.log("    GET  /home/status             (optional auth)");
  console.log("    GET  /tracker/data?date=      (auth required)");
  console.log("    POST /tracker/report          (auth required)");
  console.log("    POST /vault/upload            (auth required)");
  console.log("    GET  /vault/files             (auth required)");
  console.log("    DEL  /vault/files/:id         (auth required)");
  console.log("    GET  /map/locations           (optional auth)");
  console.log("    POST /map/locations           (auth required)");
  console.log("    PATC /map/locations/:id       (auth required)");
  console.log("    DEL  /map/locations/:id       (auth required)");
  console.log("\n  \x1b[33m⚠️   Auth: pass any Bearer token (e.g. Authorization: Bearer dev)\x1b[0m");
  console.log("  \x1b[90m    Data resets on server restart.\x1b[0m\n");
});
