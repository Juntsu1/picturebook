import { readFileSync } from 'fs';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let app: App;
let db: Firestore;

export function initFirebase(): void {
  if (getApps().length === 0) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'))
      : JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    app = initializeApp({
      credential: cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
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
