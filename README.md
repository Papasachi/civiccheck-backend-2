# CivicCheck Backend

Production Node.js/Express backend with Firebase Auth, Firestore, and Storage.

## Quick Start

### 1. Prerequisites
- Node.js 18+
- A Firebase project ([create one](https://console.firebase.google.com))

### 2. Firebase Setup (one-time)

1. Go to **Firebase Console → Project Settings → Service Accounts**
2. Click **Generate new private key** → download the JSON file
3. In **Firebase Console → Firestore**, create a database in production mode
4. In **Firebase Console → Storage**, enable Cloud Storage
5. In **Firebase Console → Authentication**, enable your sign-in providers
   (Google, Apple, and/or Email/Password)

### 3. Install & Configure

```bash
cd civiccheck-backend
npm install

# Create your .env from the template
cp .env.example .env
```

Open `.env` and fill in your Firebase credentials from the downloaded JSON key.

### 4. Run

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

The server starts on `http://localhost:4000`.

---

## API Reference

### Authentication
All protected routes require a Firebase ID token:
```
Authorization: Bearer <firebase-id-token>
```

Get a token in your React Native app:
```js
import auth from '@react-native-firebase/auth';
const token = await auth().currentUser.getIdToken();
```

---

### GET /health
Public. Returns server status.

---

### GET /home/status
Optional auth. Returns welcome message + latest reports.

```json
{
  "message": "Welcome back, Jane 👋",
  "stats": { "totalReports": 42 },
  "latestReports": [...]
}
```

---

### GET /tracker/data?date=YYYY-MM-DD
Auth required. Returns 7-day chart data ending on `date`.

```json
{
  "date": "2025-10-01",
  "totalReports": 12,
  "chartData": [
    { "label": "Mon, Sep 25", "value": 2, "date": "2025-09-25" },
    ...
  ]
}
```

### POST /tracker/report
Auth required. Submit a new civic report.

```json
// Request body
{
  "title": "Pothole on Main St",
  "description": "Large pothole near intersection",
  "category": "infrastructure",
  "location": { "lat": 40.7128, "lng": -74.006 }
}
```

---

### POST /vault/upload
Auth required. Multipart form upload (field: `file`).
Max size set by `MAX_FILE_SIZE_MB` env var (default 10 MB).
Allowed types: JPEG, PNG, PDF, MP4.

### GET /vault/files
Auth required. Returns files uploaded by the current user.

### DELETE /vault/files/:fileId
Auth required. Deletes own file from Storage and Firestore.

---

### GET /map/locations
Optional auth. Query params:
- `?tag=pothole` — filter by tag
- `?lat=40.7&lng=-74.0&radiusKm=10` — bounding box

### POST /map/locations
Auth required. Pin a new civic issue on the map.

```json
{
  "name": "Broken streetlight",
  "description": "Out since last week",
  "latitude": 40.7128,
  "longitude": -74.006,
  "tags": ["lighting", "safety"]
}
```

### PATCH /map/locations/:id
Auth required. Update status (`open` | `in_progress` | `resolved`).

### DELETE /map/locations/:id
Auth required. Own markers only.

---

## Deployment (Railway / Render / Fly.io)

All three platforms work the same way:

1. Push this folder to a GitHub repo
2. Create a new project and connect the repo
3. Set all environment variables from `.env.example` in the platform dashboard
4. Set `NODE_ENV=production`
5. The start command is `npm start`

For **Expo EAS** builds, update your app's API base URL to point to the deployed URL.

---

## Firestore Security Rules

Paste these into Firebase Console → Firestore → Rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /reports/{doc} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update, delete: if request.auth.uid == resource.data.submittedBy;
    }

    match /vault_files/{doc} {
      allow read, write: if request.auth.uid == resource.data.uploadedBy;
      allow create: if request.auth != null;
    }

    match /map_locations/{doc} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update, delete: if request.auth.uid == resource.data.createdBy;
    }
  }
}
```

## Storage Security Rules

Firebase Console → Storage → Rules (paste the contents of `storage.rules`):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /vault/{userId}/{fileId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null
                   && request.auth.uid == userId
                   && request.resource.size <= 10 * 1024 * 1024
                   && request.resource.contentType.matches(
                        'image/jpeg|image/png|application/pdf|video/mp4'
                      );
      allow delete: if request.auth != null && request.auth.uid == userId;
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```
