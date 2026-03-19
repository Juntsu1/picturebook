import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getDb } from '../lib/firebase.js';

export interface BookDoc {
  profileId: string;
  title: string;
  theme: string;
  status: 'generating' | 'completed' | 'error';
  thumbnailUrl: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PageDoc {
  pageNumber: number;
  text: string;
  originalText: string;
  imageUrl: string;
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

  return snapshot.docs.map((doc) => {
    const data = doc.data() as BookDoc;
    return {
      id: doc.id,
      title: data.title,
      thumbnailUrl: data.thumbnailUrl,
      createdAt: data.createdAt.toDate().toISOString(),
      updatedAt: data.updatedAt.toDate().toISOString(),
    };
  });
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

  const pages = pagesSnap.docs.map((doc) => {
    const p = doc.data() as PageDoc;
    return {
      pageNumber: p.pageNumber,
      text: p.text,
      originalText: p.originalText,
      imageUrl: p.imageUrl,
    };
  });

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
