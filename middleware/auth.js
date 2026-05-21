const { getAuth } = require("../config/firebase");

/**
 * Middleware: verify Firebase ID token sent as Bearer token.
 * Attaches decoded token (uid, email, etc.) to req.user.
 *
 * Usage:
 *   router.get("/protected", requireAuth, (req, res) => {
 *     res.json({ uid: req.user.uid });
 *   });
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorised",
      message: "Missing or malformed Authorization header. Expected: Bearer <token>",
    });
  }

  const idToken = authHeader.slice(7); // strip "Bearer "

  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    req.user = decoded; // { uid, email, name, picture, ... }
    next();
  } catch (err) {
    console.warn("Auth token verification failed:", err.code, err.message);

    const status = err.code === "auth/id-token-expired" ? 401 : 403;
    return res.status(status).json({
      error: "Unauthorised",
      message:
        err.code === "auth/id-token-expired"
          ? "Token expired. Please sign in again."
          : "Invalid token.",
    });
  }
}

/**
 * Optional auth — attaches req.user if token present, but does not block
 * unauthenticated requests. Useful for public + personalised endpoints.
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return next();

  try {
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    req.user = decoded;
  } catch {
    // ignore invalid tokens for optional auth
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
