#!/usr/bin/env node
/**
 * CivicCheck — Pre-deploy Validator
 * Run this before pushing to Railway to catch config issues early.
 *
 * Usage:  node validate-env.js
 */

try { require("dotenv").config(); } catch { /* dotenv not yet installed */ }

const REQUIRED = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_STORAGE_BUCKET",
];

const OPTIONAL = [
  "PORT",
  "NODE_ENV",
  "CORS_ORIGINS",
  "MAX_FILE_SIZE_MB",
  "RATE_LIMIT_WINDOW_MINUTES",
  "RATE_LIMIT_MAX_REQUESTS",
];

let passed = 0;
let failed = 0;

function ok(msg)   { console.log(`  ✅  ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌  ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️   ${msg}`); }
function section(title) { console.log(`\n── ${title} ${"─".repeat(44 - title.length)}`); }

console.log("\n╔══════════════════════════════════════════════╗");
console.log("║   CivicCheck — Pre-deploy Validator          ║");
console.log("╚══════════════════════════════════════════════╝");

// ── 1. Required env vars ──────────────────────────────────────────────────────
section("Required environment variables");
REQUIRED.forEach((key) => {
  if (process.env[key]) {
    ok(`${key} is set`);
  } else {
    fail(`${key} is MISSING — add it to .env`);
  }
});

// ── 2. Optional env vars ──────────────────────────────────────────────────────
section("Optional environment variables");
OPTIONAL.forEach((key) => {
  if (process.env[key]) {
    ok(`${key} = ${key === "FIREBASE_PRIVATE_KEY" ? "[hidden]" : process.env[key]}`);
  } else {
    warn(`${key} not set — will use default`);
  }
});

// ── 3. Firebase private key format ───────────────────────────────────────────
section("Firebase private key format");
const rawKey = process.env.FIREBASE_PRIVATE_KEY || "";
const key = rawKey.replace(/\\n/g, "\n");

if (key.includes("BEGIN PRIVATE KEY") && key.includes("END PRIVATE KEY")) {
  ok("Private key has correct PEM format");
} else if (rawKey) {
  fail(
    "FIREBASE_PRIVATE_KEY looks malformed.\n" +
    "     In .env it should be wrapped in double quotes with literal \\n:\n" +
    '     FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nABC...\\n-----END PRIVATE KEY-----\\n"'
  );
} else {
  fail("FIREBASE_PRIVATE_KEY is not set");
}

if (process.env.FIREBASE_CLIENT_EMAIL) {
  const emailOk = process.env.FIREBASE_CLIENT_EMAIL.includes("@") &&
                  process.env.FIREBASE_CLIENT_EMAIL.includes("iam.gserviceaccount.com");
  emailOk
    ? ok("Client email looks like a valid service account email")
    : fail("FIREBASE_CLIENT_EMAIL doesn't look like a service account email. Check your Firebase JSON key.");
}

if (process.env.FIREBASE_STORAGE_BUCKET) {
  const bucketOk = process.env.FIREBASE_STORAGE_BUCKET.includes(".appspot.com") ||
                   process.env.FIREBASE_STORAGE_BUCKET.includes(".firebasestorage.app");
  bucketOk
    ? ok("Storage bucket format looks correct")
    : warn("FIREBASE_STORAGE_BUCKET should end in .appspot.com — double-check Firebase Console → Storage");
}

// ── 4. package.json sanity ───────────────────────────────────────────────────
section("package.json");
try {
  const pkg = require("./package.json");
  pkg.scripts?.start ? ok(`start script: "${pkg.scripts.start}"`) : fail("No start script in package.json");
  pkg.engines?.node  ? ok(`Node engine: ${pkg.engines.node}`) : warn("No engines.node specified (Railway will use latest)");
  const deps = Object.keys(pkg.dependencies || {});
  ok(`${deps.length} dependencies declared`);
} catch (e) {
  fail("Could not read package.json: " + e.message);
}

// ── 5. Key files present ──────────────────────────────────────────────────────
section("Required files");
const fs = require("fs");
const files = [
  ["server.js",              "Main production server"],
  ["stub-server.js",         "Offline stub server"],
  ["railway.toml",           "Railway deploy config"],
  ["firestore.rules",        "Firestore security rules"],
  ["storage.rules",          "Firebase Storage rules"],
  ["firestore.indexes.json", "Firestore indexes"],
  [".github/workflows/ci-cd.yml", "GitHub Actions CI/CD"],
];
files.forEach(([f, desc]) => {
  fs.existsSync(f) ? ok(`${f} — ${desc}`) : fail(`${f} MISSING — ${desc}`);
});

// ── 6. .gitignore safety ──────────────────────────────────────────────────────
section(".gitignore safety");
try {
  const gi = fs.readFileSync(".gitignore", "utf8");
  gi.includes(".env")          ? ok(".env is gitignored (credentials safe)") : fail(".env is NOT in .gitignore — fix this before pushing!");
  gi.includes("node_modules")  ? ok("node_modules is gitignored") : warn("node_modules not in .gitignore");
} catch {
  warn(".gitignore not found — create one before pushing");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════╗");
console.log(`║  Results:  ${String(passed).padEnd(3)} passed  |  ${String(failed).padEnd(3)} failed            ║`);
console.log("╚══════════════════════════════════════════════╝\n");

if (failed > 0) {
  console.log("  Fix the issues above, then re-run: node validate-env.js\n");
  process.exit(1);
} else {
  console.log("  ✅  All checks passed — safe to deploy!\n");
  console.log("  Next step:  git push origin main\n");
  process.exit(0);
}
