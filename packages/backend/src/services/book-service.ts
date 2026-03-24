import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getDb } from '../lib/firebase.js';

const SIGNED_URL_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days
const SIGNED_URL_REFRESH_THRESHOLD_MS = 1 * 24 * 60 * 60 * 1000; // refresh if < 1 day left

/**
 * URLが有効期限内であればそのまま返し、期限切れ/未設定なら再生成して
 * Firestoreドキュメントを更新する。
 */
async function getOrRefreshSignedUrl(
  url: string | null,
  expiresAt: Timestamp | null,
  storagePath: string,
  docRef: FirebaseFirestore.DocumentReference,
  urlField: string,
  expiresField: string,
): Promise<string | null> {
  if (!url) return null;

  const now = Date.now();
  const expMs = expiresAt ? expiresAt.toMillis() : 0;

  // URLがまだ有効なら再利用
  if (expMs - now > SIGNED_URL_REFRESH_THRESHOLD_MS) {
    return url;
  }

  // 再生成
  try {
    const bucket = getStorage().bucket();
    const newExpiry = now + SIGNED_URL_TTL_MS;
    const [signedUrl] = await bucket.file(storagePath).getSignedUrl({
      action: 'read',
      expires: newExpiry,
    });
    // Firestoreを非同期で更新（レスポンスをブロックしない）
    docRef.update({
      [urlField]: signedUrl,
      [expiresField]: Timestamp.fromMillis(newExpiry),
    }).catch(() => {/* non-fatal */});
    return signedUrl;
  } catch {
    return url; // 失敗したら古いURLをそのまま返す
  }
}

/**
 * 署名付きURLからStorage内のパスを抽出する。
 */
function extractStoragePath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'storage.googleapis.com') {
      const parts = parsed.pathname.split('/').slice(2);
      return parts.join('/');
    }
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      const match = parsed.pathname.match(/\/v0\/b\/[^/]+\/o\/(.+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  } catch { /* ignore */ }
  return null;
}

export interface BookDoc {
  profileId: string;
  title: string;
  theme: string;
  status: 'generating' | 'completed' | 'error';
  thumbnailUrl: string | null;
  thumbnailUrlExpiresAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PageDoc {
  pageNumber: number;
  text: string;
  originalText: string;
  imageUrl: string;
  imageUrlExpiresAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

function getBooksCollection(userId: string) {
  return getDb().collection('users').doc(userId).collection('books');
}

function getPagesCollection(userId: string, bookId: string) {
  return getBooksCollection(userId).doc(bookId).collection('pages');
}

export async function createBook(
  userId: string,
  data: { profileId: string; title: string; theme: string }
): Promise<string> {
  const now = Timestamp.now();
  const doc: BookDoc = {
    profileId: data.profileId,
    title: data.title,
    theme: data.theme,
    status: 'generating',
    thumbnailUrl: null,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await getBooksCollection(userId).add(doc);
  return ref.id;
}

export async function savePages(
  userId: string,
  bookId: string,
  pages: { pageNumber: number; text: string; imageUrl: string }[]
): Promise<void> {
  const batch = getDb().batch();
  const now = Timestamp.now();
  const pagesCol = getPagesCollection(userId, bookId);

  for (const page of pages) {
    const pageDoc: PageDoc = {
      pageNumber: page.pageNumber,
      text: page.text,
      originalText: page.text,
      imageUrl: page.imageUrl,
      imageUrlExpiresAt: Timestamp.fromMillis(Date.now() + SIGNED_URL_TTL_MS),
      createdAt: now,
      updatedAt: now,
    };
    const ref = pagesCol.doc(`page-${page.pageNumber}`);
    batch.set(ref, pageDoc);
  }

  await batch.commit();
}

export async function updateBookStatus(
  userId: string,
  bookId: string,
  status: 'generating' | 'completed' | 'error',
  thumbnailUrl?: string
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    updatedAt: Timestamp.now(),
  };
  if (thumbnailUrl !== undefined) {
    update.thumbnailUrl = thumbnailUrl;
    update.thumbnailUrlExpiresAt = Timestamp.fromMillis(Date.now() + SIGNED_URL_TTL_MS);
  }
  await getBooksCollection(userId).doc(bookId).update(update);
}

export interface BookSummary {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookDetail {
  id: string;
  title: string;
  profileId: string;
  theme: string;
  pages: { pageNumber: number; text: string; originalText: string; imageUrl: string }[];
  createdAt: string;
  updatedAt: string;
}

export async function getBooks(userId: string): Promise<BookSummary[]> {
  const snapshot = await getBooksCollection(userId)
    .orderBy('createdAt', 'desc')
    .get();

  return Promise.all(
    snapshot.docs.map(async (doc) => {
      const data = doc.data() as BookDoc;
      const storagePath = data.thumbnailUrl ? extractStoragePath(data.thumbnailUrl) : null;
      const thumbnailUrl = storagePath
        ? await getOrRefreshSignedUrl(
            data.thumbnailUrl,
            data.thumbnailUrlExpiresAt ?? null,
            storagePath,
            doc.ref,
            'thumbnailUrl',
            'thumbnailUrlExpiresAt',
          )
        : data.thumbnailUrl;
      return {
        id: doc.id,
        title: data.title,
        thumbnailUrl,
        createdAt: data.createdAt.toDate().toISOString(),
        updatedAt: data.updatedAt.toDate().toISOString(),
      };
    })
  );
}

export async function getBookById(userId: string, bookId: string): Promise<BookDetail | null> {
  const bookSnap = await getBooksCollection(userId).doc(bookId).get();
  if (!bookSnap.exists) {
    return null;
  }

  const bookData = bookSnap.data() as BookDoc;

  const pagesSnap = await getPagesCollection(userId, bookId)
    .orderBy('pageNumber', 'asc')
    .get();

  const pages = await Promise.all(
    pagesSnap.docs.map(async (doc) => {
      const p = doc.data() as PageDoc;
      const storagePath = extractStoragePath(p.imageUrl);
      const imageUrl = storagePath
        ? await getOrRefreshSignedUrl(
            p.imageUrl,
            p.imageUrlExpiresAt ?? null,
            storagePath,
            doc.ref,
            'imageUrl',
            'imageUrlExpiresAt',
          ) ?? p.imageUrl
        : p.imageUrl;
      return {
        pageNumber: p.pageNumber,
        text: p.text,
        originalText: p.originalText,
        imageUrl,
      };
    })
  );

  return {
    id: bookSnap.id,
    title: bookData.title,
    profileId: bookData.profileId,
    theme: bookData.theme,
    pages,
    createdAt: bookData.createdAt.toDate().toISOString(),
    updatedAt: bookData.updatedAt.toDate().toISOString(),
  };
}

export async function updatePage(
  userId: string,
  bookId: string,
  pageNumber: number,
  text: string
): Promise<boolean> {
  const pageRef = getPagesCollection(userId, bookId).doc(`page-${pageNumber}`);
  const pageSnap = await pageRef.get();
  if (!pageSnap.exists) {
    return false;
  }

  await pageRef.update({
    text,
    updatedAt: Timestamp.now(),
  });

  // Also update book's updatedAt
  await getBooksCollection(userId).doc(bookId).update({
    updatedAt: Timestamp.now(),
  });

  return true;
}

export async function deleteBook(
  userId: string,
  bookId: string,
  storageBucket?: { deleteFiles: (opts: { prefix: string }) => Promise<void> }
): Promise<boolean> {
  const bookRef = getBooksCollection(userId).doc(bookId);
  const bookSnap = await bookRef.get();
  if (!bookSnap.exists) {
    return false;
  }

  // Delete all pages subcollection docs
  const pagesSnap = await getPagesCollection(userId, bookId).get();
  const batch = getDb().batch();
  for (const doc of pagesSnap.docs) {
    batch.delete(doc.ref);
  }
  batch.delete(bookRef);
  await batch.commit();

  // Delete Firebase Storage files
  const bucket = storageBucket ?? getStorage().bucket();
  const prefix = `users/${userId}/books/${bookId}/`;
  try {
    await bucket.deleteFiles({ prefix });
  } catch {
    // Storage deletion failure is non-fatal; Firestore docs are already removed
  }

  return true;
}
