import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let app: App;
let db: Firestore;

export function initFirebase(): void {
  if (getApps().length === 0) {
    app = initializeApp({
      credential: cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}')
      ),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}').project_id}.appspot.com`,
    });
  } else {
    app = getApps()[0];
  }
  db = getFirestore(app);
}

export function getDb(): Firestore {
  if (!db) {
    initFirebase();
  }
  return db;
}
