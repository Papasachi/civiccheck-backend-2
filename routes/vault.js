const { Router } = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { getDb, getBucket } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");

const router = Router();

// ─── Multer: store in memory, validate type & size ───────────────────────────
const ALLOWED_TYPES = (process.env.ALLOWED_FILE_TYPES || "image/jpeg,image/png,application/pdf,video/mp4")
  .split(",")
  .map((t) => t.trim());

const MAX_SIZE_BYTES = (parseInt(process.env.MAX_FILE_SIZE_MB || "10", 10)) * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter(req, file, cb) {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        Object.assign(new Error(`File type not allowed: ${file.mimetype}`), {
          code: "INVALID_FILE_TYPE",
        }),
        false
      );
    }
  },
});

// ─── POST /vault/upload ───────────────────────────────────────────────────────
/**
 * Upload a file to Firebase Storage and record metadata in Firestore.
 * Multipart form field name: "file"
 */
router.post("/upload", requireAuth, upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided. Use multipart field name: file" });
  }

  try {
    const db = getDb();
    const bucket = getBucket();

    const fileId = uuidv4();
    const ext = req.file.originalname.split(".").pop();
    const storagePath = `vault/${req.user.uid}/${fileId}.${ext}`;

    // Upload to Firebase Storage
    const fileRef = bucket.file(storagePath);
    await fileRef.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          uploadedBy: req.user.uid,
          originalName: req.file.originalname,
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
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storagePath,
        publicUrl,
        uploadedBy: req.user.uid,
        uploadedAt: now,
      });

    return res.status(200).json({
      fileId,
      status: "uploaded",
      name: req.file.originalname,
      url: publicUrl,
      uploadedAt: now.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

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

// ─── Multer error handler ─────────────────────────────────────────────────────
router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: `File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 10} MB`,
    });
  }
  if (err.code === "INVALID_FILE_TYPE") {
    return res.status(415).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
