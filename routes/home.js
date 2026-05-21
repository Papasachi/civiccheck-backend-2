const { Router } = require("express");
const { getDb } = require("../config/firebase");
const { optionalAuth } = require("../middleware/auth");

const router = Router();

/**
 * GET /home/status
 * Returns a welcome message + high-level stats for the home screen.
 * Auth is optional — logged-in users get personalised data.
 */
router.get("/status", optionalAuth, async (req, res, next) => {
  try {
    const db = getDb();
    const reportsRef = db.collection(process.env.REPORTS_COLLECTION || "reports");

    // Fetch total report count
    const snapshot = await reportsRef.count().get();
    const totalReports = snapshot.data().count;

    // Latest 3 reports for the feed
    const latestSnap = await reportsRef
      .orderBy("createdAt", "desc")
      .limit(3)
      .get();

    const latestReports = latestSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate().toISOString(),
    }));

    const displayName = req.user?.name || req.user?.email || null;

    return res.json({
      message: displayName
        ? `Welcome back, ${displayName} 👋`
        : "Welcome to CivicCheck 🚀",
      stats: {
        totalReports,
        activeUsers: null, // extend with your own analytics
      },
      latestReports,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
