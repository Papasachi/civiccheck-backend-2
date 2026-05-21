const admin = require("firebase-admin");

let db;
let bucket;

function initFirebase() {
  if (admin.apps.length > 0) return; // already initialized

  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined;

  if (
    !process.env.FIREBASE_PROJECT_ID ||
    !process.env.FIREBASE_CLIENT_EMAIL ||
    !privateKey
  ) {
    console.error(
      "❌  Missing Firebase credentials. Check your .env file.\n" +
        "    Required: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  db = admin.firestore();
  bucket = admin.storage().bucket();

  console.log(
    `✅  Firebase initialised (project: ${process.env.FIREBASE_PROJECT_ID})`
  );
}

function getDb() {
  if (!db) throw new Error("Firebase not initialised. Call initFirebase() first.");
  return db;
}

function getBucket() {
  if (!bucket) throw new Error("Firebase not initialised. Call initFirebase() first.");
  return bucket;
}

function getAuth() {
  return admin.auth();
}

module.exports = { initFirebase, getDb, getBucket, getAuth };
