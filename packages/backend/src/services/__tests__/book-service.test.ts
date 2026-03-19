import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

// ── In-memory Firestore mock ────────────────────────────────────────────────

interface MockDoc {
  id: string;
  data: Record<string, unknown>;
}

function createMockFirestore() {
  const collections: Record<string, MockDoc[]> = {};

  function getCollection(path: string): MockDoc[] {
    if (!collections[path]) collections[path] = [];
    return collections[path];
  }

  let idCounter = 0;

  function buildDocRef(colPath: string, docId: string) {
    return {
      _path: colPath,
      _id: docId,
      get ref() { return { _path: colPath, _id: docId }; },
      async get() {
        const found = getCollection(colPath).find((d) => d.id === docId);
        if (!found) return { exists: false, id: docId, data: () => undefined };
        return { exists: true, id: found.id, data: () => ({ ...found.data }) };
      },
      async update(data: Record<string, unknown>) {
        const found = getCollection(colPath).find((d) => d.id === docId);
        if (found) Object.assign(found.data, data);
      },
      collection(subName: string) {
        return buildCollection(`${colPath}/${docId}/${subName}`);
      },
    };
  }

  function buildCollection(path: string) {
    return {
      async add(data: Record<string, unknown>) {
        const id = `doc-${++idCounter}`;
        getCollection(path).push({ id, data: { ...data } });
        return { id };
      },
      orderBy(_field: string, _dir?: string) {
        return {
          async get() {
            const docs = getCollection(path);
            return {
              docs: docs.map((d) => ({
                id: d.id,
                ref: { _path: path, _id: d.id },
                data: () => ({ ...d.data }),
                exists: true,
              })),
            };
          },
        };
      },
      doc(docId: string) {
        return buildDocRef(path, docId);
      },
      async get() {
        const docs = getCollection(path);
        return {
          docs: docs.map((d) => ({
            id: d.id,
            ref: { _path: path, _id: d.id },
            data: () => ({ ...d.data }),
            exists: true,
          })),
        };
      },
    };
  }

  const firestore = {
    batch() {
      const ops: Array<{ type: 'set' | 'delete'; path: string; docId: string; data?: Record<string, unknown> }> = [];
      return {
        set(ref: { _path: string; _id: string }, data: Record<string, unknown>) {
          ops.push({ type: 'set', path: ref._path, docId: ref._id, data });
        },
        delete(ref: { _path: string; _id: string }) {
          ops.push({ type: 'delete', path: ref._path, docId: ref._id });
        },
        async commit() {
          for (const op of ops) {
            if (op.type === 'set') {
              const col = getCollection(op.path);
              const existing = col.findIndex((d) => d.id === op.docId);
              if (existing >= 0) {
                col[existing].data = { ...op.data! };
              } else {
                col.push({ id: op.docId, data: { ...op.data! } });
              }
            } else if (op.type === 'delete') {
              const col = getCollection(op.path);
              const idx = col.findIndex((d) => d.id === op.docId);
              if (idx >= 0) col.splice(idx, 1);
            }
          }
        },
      };
    },
    collection(name: string) {
      return buildCollection(name);
    },
  };

  return {
    firestore,
    getCollection,
    reset: () => {
      Object.keys(collections).forEach((k) => delete collections[k]);
      idCounter = 0;
    },
  };
}

const mockFs = createMockFirestore();
const mockDeleteFiles = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/firebase.js', () => ({
  getDb: () => mockFs.firestore,
  initFirebase: () => {},
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      deleteFiles: mockDeleteFiles,
    }),
  }),
}));

const {
  createBook,
  savePages,
  getBooks,
  getBookById,
  updatePage,
  deleteBook,
} = await import('../book-service.js');

describe('book-service', () => {
  beforeEach(() => {
    mockFs.reset();
    vi.clearAllMocks();
  });

  async function seedBook(userId: string) {
    const bookId = await createBook(userId, {
      profileId: 'profile-1',
      title: 'テスト絵本',
      theme: 'adventure',
    });
    await savePages(userId, bookId, [
      { pageNumber: 1, text: 'ページ1のテキスト', imageUrl: 'https://example.com/p1.png' },
      { pageNumber: 2, text: 'ページ2のテキスト', imageUrl: 'https://example.com/p2.png' },
    ]);
    return bookId;
  }

  describe('getBooks', () => {
    it('ユーザーの絵本一覧を取得できる', async () => {
      await seedBook('user-1');
      await createBook('user-1', { profileId: 'p2', title: '2冊目', theme: 'space' });

      const books = await getBooks('user-1');
      expect(books).toHaveLength(2);
      expect(books[0].title).toBeTruthy();
      expect(books[0].id).toBeTruthy();
      expect(books[0].createdAt).toBeTruthy();
    });

    it('絵本がない場合は空配列を返す', async () => {
      const books = await getBooks('user-empty');
      expect(books).toEqual([]);
    });
  });

  describe('getBookById', () => {
    it('絵本の詳細をページ付きで取得できる', async () => {
      const bookId = await seedBook('user-1');

      const book = await getBookById('user-1', bookId);
      expect(book).not.toBeNull();
      expect(book!.title).toBe('テスト絵本');
      expect(book!.theme).toBe('adventure');
      expect(book!.pages).toHaveLength(2);
      expect(book!.pages[0].text).toBe('ページ1のテキスト');
    });

    it('存在しない絵本はnullを返す', async () => {
      const book = await getBookById('user-1', 'nonexistent');
      expect(book).toBeNull();
    });
  });

  describe('updatePage', () => {
    it('ページテキストを更新できる', async () => {
      const bookId = await seedBook('user-1');

      const result = await updatePage('user-1', bookId, 1, '更新テキスト');
      expect(result).toBe(true);

      const book = await getBookById('user-1', bookId);
      expect(book!.pages[0].text).toBe('更新テキスト');
    });

    it('存在しないページの更新はfalseを返す', async () => {
      const bookId = await seedBook('user-1');

      const result = await updatePage('user-1', bookId, 99, 'テスト');
      expect(result).toBe(false);
    });
  });

  describe('deleteBook', () => {
    it('絵本とページを削除できる', async () => {
      const bookId = await seedBook('user-1');
      const mockBucket = { deleteFiles: vi.fn().mockResolvedValue(undefined) };

      const result = await deleteBook('user-1', bookId, mockBucket as any);
      expect(result).toBe(true);

      const book = await getBookById('user-1', bookId);
      expect(book).toBeNull();

      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
        prefix: `users/user-1/books/${bookId}/`,
      });
    });

    it('存在しない絵本の削除はfalseを返す', async () => {
      const result = await deleteBook('user-1', 'nonexistent', { deleteFiles: vi.fn() } as any);
      expect(result).toBe(false);
    });

    it('Storage削除失敗でもFirestoreの削除は成功する', async () => {
      const bookId = await seedBook('user-1');
      const mockBucket = { deleteFiles: vi.fn().mockRejectedValue(new Error('Storage error')) };

      const result = await deleteBook('user-1', bookId, mockBucket as any);
      expect(result).toBe(true);

      const book = await getBookById('user-1', bookId);
      expect(book).toBeNull();
    });
  });
});
