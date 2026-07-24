const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getDb, getBucket } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ─── Upload limits ────────────────────────────────────────────────────────────
const ALLOWED_TYPES = (process.env.ALLOWED_FILE_TYPES || "image/jpeg,image/png,application/pdf,video/mp4")
  .split(",")
  .map((t) => t.trim());

const MAX_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10)) * 1024 * 1024;

// Base64 inflates payload size by ~4/3; add headroom for JSON framing.
const JSON_BODY_LIMIT = `${Math.ceil((MAX_SIZE_BYTES * 4) / 3 / (1024 * 1024)) + 2}mb`;

// ─── POST /vault/upload ───────────────────────────────────────────────────────
/**
 * Upload a file to Firebase Storage and record metadata in Firestore.
 * JSON body: { base64: string, mimeType: string, filename: string }
 */
router.post(
  "/upload",
  requireAuth,
  express.json({ limit: JSON_BODY_LIMIT }),
  async (req, res, next) => {
    const { base64, mimeType, filename } = req.body || {};

    if (!base64 || !mimeType || !filename) {
      return res.status(400).json({ error: "Missing required fields: base64, mimeType, filename" });
    }

    if (!ALLOWED_TYPES.includes(mimeType)) {
      return res.status(415).json({ error: `File type not allowed: ${mimeType}` });
    }

    let buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      return res.status(400).json({ error: "Invalid base64 data" });
    }

    if (buffer.length === 0) {
      return res.status(400).json({ error: "Empty file" });
    }

    if (buffer.length > MAX_SIZE_BYTES) {
      return res.status(413).json({
        error: `File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 10} MB`,
      });
    }

    try {
      const db = getDb();
      const bucket = getBucket();

      const fileId = uuidv4();
      const ext = filename.split(".").pop();
      const storagePath = `vault/${req.user.uid}/${fileId}.${ext}`;

      // Upload to Firebase Storage
      const fileRef = bucket.file(storagePath);
      await fileRef.save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata: {
            uploadedBy: req.user.uid,
            originalName: filename,
          },
        },
      });

      // Make the file publicly readable (remove if you want private signed URLs)
      await fileRef.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

      // Record metadata in Firestore
      const now = new Date();
      await db
        .collection(process.env.FILES_COLLECTION || "vault_files")
        .doc(fileId)
        .set({
          fileId,
          name: filename,
          mimeType,
          sizeBytes: buffer.length,
          storagePath,
          publicUrl,
          uploadedBy: req.user.uid,
          uploadedAt: now,
        });

      return res.status(200).json({
        fileId,
        status: "uploaded",
        name: filename,
        url: publicUrl,
        uploadedAt: now.toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /vault/files ─────────────────────────────────────────────────────────
/**
 * List all files uploaded by the authenticated user.
 */
router.get("/files", requireAuth, async (req, res, next) => {
  try {
    const db = getDb();
    // orderBy("uploadedAt") omitted — the composite index may not be deployed.
    // We sort the (≤50) results in memory instead.
    const snapshot = await db
      .collection(process.env.FILES_COLLECTION || "vault_files")
      .where("uploadedBy", "==", req.user.uid)
      .limit(50)
      .get();

    const files = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          fileId: d.fileId,
          name: d.name,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          url: d.publicUrl,
          uploadedAt: d.uploadedAt?.toDate().toISOString() ?? null,
        };
      })
      .sort((a, b) => {
        if (!a.uploadedAt) return 1;
        if (!b.uploadedAt) return -1;
        return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
      });

    return res.json(files);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /vault/files/:fileId ─────────────────────────────────────────────
/**
 * Delete a file from Storage and Firestore.
 */
router.delete("/files/:fileId", requireAuth, async (req, res, next) => {
  const { fileId } = req.params;

  try {
    const db = getDb();
    const bucket = getBucket();
    const docRef = db.collection(process.env.FILES_COLLECTION || "vault_files").doc(fileId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "File not found" });
    }

    const data = doc.data();

    if (data.uploadedBy !== req.user.uid) {
      return res.status(403).json({ error: "Forbidden: you do not own this file" });
    }

    // Delete from Storage
    await bucket.file(data.storagePath).delete();

    // Delete Firestore record
    await docRef.delete();

    return res.json({ fileId, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
