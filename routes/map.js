const { Router } = require("express");
const { body, query, validationResult } = require("express-validator");
const { getDb } = require("../config/firebase");
const { requireAuth, optionalAuth } = require("../middleware/auth");

const router = Router();

// ─── GET /map/locations ───────────────────────────────────────────────────────
/**
 * List map markers. Auth optional — returns all public markers.
 * Optional query params:
 *   ?lat=40.7&lng=-74.0&radiusKm=10   (bounding box filter)
 *   ?tag=pothole                       (filter by tag)
 */
router.get("/locations", optionalAuth, async (req, res, next) => {
  try {
    const db = getDb();
    let ref = db.collection(process.env.LOCATIONS_COLLECTION || "map_locations");

    // Filter by tag if provided
    if (req.query.tag) {
      ref = ref.where("tags", "array-contains", req.query.tag);
    }

    const snapshot = await ref.orderBy("createdAt", "desc").limit(200).get();

    let locations = snapshot.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        name: d.name,
        description: d.description || null,
        latitude: d.latitude,
        longitude: d.longitude,
        tags: d.tags || [],
        status: d.status || "open",
        createdAt: d.createdAt?.toDate().toISOString(),
      };
    });

    // Optional bounding-box filter (client-side after fetch)
    if (req.query.lat && req.query.lng && req.query.radiusKm) {
      const lat = parseFloat(req.query.lat);
      const lng = parseFloat(req.query.lng);
      const radiusKm = parseFloat(req.query.radiusKm);

      // Rough bounding box (1 degree ≈ 111 km)
      const delta = radiusKm / 111;
      locations = locations.filter(
        (l) =>
          Math.abs(l.latitude - lat) <= delta &&
          Math.abs(l.longitude - lng) <= delta
      );
    }

    return res.json(locations);
  } catch (err) {
    next(err);
  }
});

// ─── POST /map/locations ──────────────────────────────────────────────────────
/**
 * Create a new map marker (pin a civic issue on the map).
 */
router.post(
  "/locations",
  requireAuth,
  [
    body("name").notEmpty().withMessage("name is required"),
    body("latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("latitude must be between -90 and 90"),
    body("longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("longitude must be between -180 and 180"),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { name, description, latitude, longitude, tags } = req.body;

    try {
      const db = getDb();
      const ref = db.collection(process.env.LOCATIONS_COLLECTION || "map_locations");

      const docRef = await ref.add({
        name,
        description: description || "",
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        tags: Array.isArray(tags) ? tags : [],
        status: "open",
        createdBy: req.user.uid,
        createdAt: new Date(),
      });

      return res.status(201).json({
        id: docRef.id,
        name,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        status: "open",
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /map/locations/:id ─────────────────────────────────────────────────
/**
 * Update a marker's status (e.g. open → resolved).
 */
router.patch("/locations/:id", requireAuth, async (req, res, next) => {
  const { id } = req.params;
  const { status, name, description, tags } = req.body;

  const allowedStatuses = ["open", "in_progress", "resolved"];
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${allowedStatuses.join(", ")}`,
    });
  }

  try {
    const db = getDb();
    const docRef = db
      .collection(process.env.LOCATIONS_COLLECTION || "map_locations")
      .doc(id);

    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Location not found" });

    const updates = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (tags) updates.tags = tags;

    await docRef.update(updates);
    return res.json({ id, ...updates, updatedAt: updates.updatedAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /map/locations/:id ────────────────────────────────────────────────
router.delete("/locations/:id", requireAuth, async (req, res, next) => {
  const { id } = req.params;
  try {
    const db = getDb();
    const docRef = db
      .collection(process.env.LOCATIONS_COLLECTION || "map_locations")
      .doc(id);

    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ error: "Location not found" });
    if (doc.data().createdBy !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden: you do not own this marker" });
    }

    await docRef.delete();
    return res.json({ id, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
