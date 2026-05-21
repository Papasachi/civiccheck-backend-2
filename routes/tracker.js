const { Router } = require("express");
const { query, validationResult } = require("express-validator");
const { getDb } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");

const router = Router();

/**
 * GET /tracker/data?date=YYYY-MM-DD
 * Returns report count + 7-day chart data ending on the requested date.
 * Requires authentication.
 */
router.get(
  "/data",
  requireAuth,
  [
    query("date")
      .optional()
      .isISO8601()
      .withMessage("date must be a valid ISO 8601 date (YYYY-MM-DD)"),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    try {
      const db = getDb();
      const collection = process.env.REPORTS_COLLECTION || "reports";

      // Parse target date (default: today)
      const targetDate = req.query.date ? new Date(req.query.date) : new Date();
      targetDate.setHours(23, 59, 59, 999); // end of day

      const sevenDaysAgo = new Date(targetDate);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      // Query reports in date range
      const snapshot = await db
        .collection(collection)
        .where("createdAt", ">=", sevenDaysAgo)
        .where("createdAt", "<=", targetDate)
        .orderBy("createdAt", "asc")
        .get();

      // Bucket reports by day label
      const buckets = {};
      for (let i = 0; i < 7; i++) {
        const d = new Date(sevenDaysAgo);
        d.setDate(d.getDate() + i);
        const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
        const dateStr = d.toISOString().split("T")[0];
        buckets[dateStr] = { label, value: 0, date: dateStr };
      }

      snapshot.docs.forEach((doc) => {
        const ts = doc.data().createdAt?.toDate();
        if (!ts) return;
        const key = ts.toISOString().split("T")[0];
        if (buckets[key]) buckets[key].value += 1;
      });

      const chartData = Object.values(buckets);
      const totalReports = chartData.reduce((sum, b) => sum + b.value, 0);

      return res.json({
        date: targetDate.toISOString().split("T")[0],
        totalReports,
        chartData,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /tracker/report
 * Submit a new civic report.
 */
router.post("/report", requireAuth, async (req, res, next) => {
  const { title, description, category, location } = req.body;

  if (!title || !description) {
    return res.status(400).json({ error: "title and description are required" });
  }

  try {
    const db = getDb();
    const ref = db.collection(process.env.REPORTS_COLLECTION || "reports");

    const docRef = await ref.add({
      title,
      description,
      category: category || "general",
      location: location || null,
      submittedBy: req.user.uid,
      submittedByEmail: req.user.email || null,
      status: "pending",
      createdAt: new Date(),
    });

    return res.status(201).json({ id: docRef.id, status: "pending" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
