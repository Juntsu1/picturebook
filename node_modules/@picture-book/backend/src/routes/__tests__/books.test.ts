import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock all external services before importing the router
vi.mock('../../services/profile-service.js', () => ({
  getProfileById: vi.fn(),
  getProfileRawById: vi.fn(),
}));
vi.mock('../../services/story-engine.js', () => ({
  generateStory: vi.fn(),
}));
vi.mock('../../services/content-filter.js', () => ({
  checkText: vi.fn(),
}));
vi.mock('../../services/illustration-engine.js', () => ({
  generateForPage: vi.fn(),
}));
vi.mock('../../services/book-service.js', () => ({
  createBook: vi.fn(),
  savePages: vi.fn(),
  updateBookStatus: vi.fn(),
  getBooks: vi.fn(),
  getBookById: vi.fn(),
  updatePage: vi.fn(),
  deleteBook: vi.fn(),
}));
vi.mock('../../services/pdf-renderer.js', () => ({
  renderPdfWithRetry: vi.fn(),
}));
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({
        save: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  }),
}));
vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-user-id', email: 'test@example.com' };
    next();
  },
}));

import { booksRouter } from '../books.js';
import { getProfileById, getProfileRawById } from '../../services/profile-service.js';
import { generateStory } from '../../services/story-engine.js';
import { checkText } from '../../services/content-filter.js';
import { generateForPage } from '../../services/illustration-engine.js';
import { createBook, savePages, updateBookStatus, getBooks, getBookById, updatePage, deleteBook } from '../../services/book-service.js';
import { renderPdfWithRetry } from '../../services/pdf-renderer.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/books', booksRouter);
  return app;
}

function parseSSEEvents(body: string): any[] {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.replace('data: ', '')));
}

describe('POST /api/books/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid request body', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/books/generate')
      .send({ profileId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when profile not found', async () => {
    vi.mocked(getProfileRawById).mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post('/api/books/generate')
      .send({
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        theme: 'adventure',
      });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('sends correct SSE events for a successful generation pipeline', async () => {
    const mockProfile = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'たろう',
      age: 5,
      gender: null,
      favoriteColor: null,
      favoriteAnimal: null,
      appearance: null,
      photoUrl: null,
      photoStoragePath: null,
      createdAt: { toDate: () => new Date() },
      updatedAt: { toDate: () => new Date() },
    };
    vi.mocked(getProfileRawById).mockResolvedValue(mockProfile as any);

    vi.mocked(generateStory).mockResolvedValue({
      title: 'たろうの冒険',
      pages: [
        { pageNumber: 1, text: 'むかしむかし、たろうがいました。' },
        { pageNumber: 2, text: 'たろうは森へ出かけました。' },
      ],
    });

    // Simulate 8 pages for valid story (min 8 pages)
    const storyPages = Array.from({ length: 8 }, (_, i) => ({
      pageNumber: i + 1,
      text: `ページ${i + 1}のテキスト`,
    }));
    vi.mocked(generateStory).mockResolvedValue({
      title: 'たろうの冒険',
      pages: storyPages,
    });

    vi.mocked(checkText).mockResolvedValue({ safe: true, flaggedCategories: [] });
    vi.mocked(createBook).mockResolvedValue('book-123');

    vi.mocked(generateForPage).mockImplementation(async (page) => ({
      pageNumber: page.pageNumber,
      imageUrl: `https://storage.example.com/page-${page.pageNumber}.png`,
    }));

    vi.mocked(savePages).mockResolvedValue(undefined);
    vi.mocked(updateBookStatus).mockResolvedValue(undefined);

    const app = createApp();
    const res = await request(app)
      .post('/api/books/generate')
      .send({
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        theme: 'adventure',
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const events = parseSSEEvents(res.text);

    // Verify event sequence
    expect(events[0]).toEqual({ type: 'story_generating' });
    expect(events[1]).toEqual({
      type: 'story_complete',
      title: 'たろうの冒険',
      pageCount: 8,
    });

    // consistency events (Scene_Extractor integration)
    expect(events[2]).toEqual({ type: 'consistency_generating' });
    expect(events[3]).toEqual({ type: 'consistency_complete' });

    // 8 pages × 2 events (generating + complete) = 16 illustration events (offset by 4)
    for (let i = 0; i < 8; i++) {
      expect(events[4 + i * 2]).toEqual({
        type: 'illustration_generating',
        pageNumber: i + 1,
        totalPages: 8,
      });
      expect(events[5 + i * 2]).toEqual({
        type: 'illustration_complete',
        pageNumber: i + 1,
      });
    }

    // Final complete event
    const lastEvent = events[events.length - 1];
    expect(lastEvent).toEqual({ type: 'complete', bookId: 'book-123' });

    // Verify Firestore operations
    expect(createBook).toHaveBeenCalledWith('test-user-id', {
      profileId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'たろうの冒険',
      theme: 'adventure',
    });
    expect(savePages).toHaveBeenCalledWith('test-user-id', 'book-123', expect.any(Array));
    expect(updateBookStatus).toHaveBeenCalledWith(
      'test-user-id',
      'book-123',
      'completed',
      'https://storage.example.com/page-1.png'
    );
  });

  it('sends error event when content check fails', async () => {
    const mockProfile = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'たろう',
      age: 5,
      gender: null,
      favoriteColor: null,
      favoriteAnimal: null,
      appearance: null,
      photoUrl: null,
      photoStoragePath: null,
      createdAt: { toDate: () => new Date() },
      updatedAt: { toDate: () => new Date() },
    };
    vi.mocked(getProfileRawById).mockResolvedValue(mockProfile as any);

    vi.mocked(generateStory).mockResolvedValue({
      title: 'テスト',
      pages: Array.from({ length: 8 }, (_, i) => ({
        pageNumber: i + 1,
        text: `ページ${i + 1}`,
      })),
    });

    vi.mocked(checkText).mockResolvedValue({
      safe: false,
      flaggedCategories: ['violence'],
    });

    const app = createApp();
    const res = await request(app)
      .post('/api/books/generate')
      .send({
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        theme: 'adventure',
      });

    const events = parseSSEEvents(res.text);
    expect(events[0]).toEqual({ type: 'story_generating' });
    expect(events[1]).toEqual({
      type: 'error',
      message: '生成されたストーリーに不適切なコンテンツが含まれています。再試行してください。',
      retryable: true,
    });
  });

  it('sends error event and updates book status on illustration failure', async () => {
    const mockProfile = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'たろう',
      age: 5,
      gender: null,
      favoriteColor: null,
      favoriteAnimal: null,
      appearance: null,
      photoUrl: null,
      photoStoragePath: null,
      createdAt: { toDate: () => new Date() },
      updatedAt: { toDate: () => new Date() },
    };
    vi.mocked(getProfileRawById).mockResolvedValue(mockProfile as any);

    vi.mocked(generateStory).mockResolvedValue({
      title: 'テスト',
      pages: Array.from({ length: 8 }, (_, i) => ({
        pageNumber: i + 1,
        text: `ページ${i + 1}`,
      })),
    });

    vi.mocked(checkText).mockResolvedValue({ safe: true, flaggedCategories: [] });
    vi.mocked(createBook).mockResolvedValue('book-456');

    const illustError = new Error('イラスト生成失敗');
    (illustError as any).retryable = true;
    vi.mocked(generateForPage).mockRejectedValue(illustError);
    vi.mocked(updateBookStatus).mockResolvedValue(undefined);

    const app = createApp();
    const res = await request(app)
      .post('/api/books/generate')
      .send({
        profileId: '550e8400-e29b-41d4-a716-446655440000',
        theme: 'adventure',
      });

    const events = parseSSEEvents(res.text);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).toBe('イラスト生成失敗');
    expect(errorEvent!.retryable).toBe(true);

    expect(updateBookStatus).toHaveBeenCalledWith('test-user-id', 'book-456', 'error');
  });
});

describe('GET /api/books', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ユーザーの絵本一覧を返す', async () => {
    vi.mocked(getBooks).mockResolvedValue([
      {
        id: 'book-1',
        title: 'たろうの冒険',
        thumbnailUrl: 'https://example.com/thumb1.png',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'book-2',
        title: 'はなこの旅',
        thumbnailUrl: null,
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/books');

    expect(res.status).toBe(200);
    expect(res.body.books).toHaveLength(2);
    expect(res.body.books[0].title).toBe('たろうの冒険');
    expect(getBooks).toHaveBeenCalledWith('test-user-id');
  });

  it('絵本がない場合は空配列を返す', async () => {
    vi.mocked(getBooks).mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).get('/api/books');

    expect(res.status).toBe(200);
    expect(res.body.books).toEqual([]);
  });
});

describe('GET /api/books/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('絵本の詳細を返す', async () => {
    vi.mocked(getBookById).mockResolvedValue({
      id: 'book-1',
      title: 'たろうの冒険',
      profileId: 'profile-1',
      theme: 'adventure',
      pages: [
        { pageNumber: 1, text: 'ページ1', originalText: 'ページ1', imageUrl: 'https://example.com/p1.png' },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    const app = createApp();
    const res = await request(app).get('/api/books/book-1');

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('たろうの冒険');
    expect(res.body.pages).toHaveLength(1);
    expect(getBookById).toHaveBeenCalledWith('test-user-id', 'book-1');
  });

  it('存在しない絵本は404を返す', async () => {
    vi.mocked(getBookById).mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get('/api/books/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('PUT /api/books/:id/pages/:pageNumber', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ページテキストを更新できる', async () => {
    vi.mocked(checkText).mockResolvedValue({ safe: true, flaggedCategories: [] });
    vi.mocked(updatePage).mockResolvedValue(true);

    const app = createApp();
    const res = await request(app)
      .put('/api/books/book-1/pages/1')
      .send({ text: '更新されたテキスト' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('ページを更新しました');
    expect(checkText).toHaveBeenCalledWith('更新されたテキスト');
    expect(updatePage).toHaveBeenCalledWith('test-user-id', 'book-1', 1, '更新されたテキスト');
  });

  it('不適切なコンテンツは400を返す', async () => {
    vi.mocked(checkText).mockResolvedValue({
      safe: false,
      flaggedCategories: ['violence'],
    });

    const app = createApp();
    const res = await request(app)
      .put('/api/books/book-1/pages/1')
      .send({ text: '不適切なテキスト' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CONTENT_UNSAFE');
    expect(updatePage).not.toHaveBeenCalled();
  });

  it('200文字超のテキストはバリデーションエラーを返す', async () => {
    const app = createApp();
    const res = await request(app)
      .put('/api/books/book-1/pages/1')
      .send({ text: 'あ'.repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('無効なページ番号は400を返す', async () => {
    const app = createApp();
    const res = await request(app)
      .put('/api/books/book-1/pages/0')
      .send({ text: 'テスト' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('存在しないページは404を返す', async () => {
    vi.mocked(checkText).mockResolvedValue({ safe: true, flaggedCategories: [] });
    vi.mocked(updatePage).mockResolvedValue(false);

    const app = createApp();
    const res = await request(app)
      .put('/api/books/book-1/pages/99')
      .send({ text: 'テスト' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/books/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('絵本を削除できる', async () => {
    vi.mocked(deleteBook).mockResolvedValue(true);

    const app = createApp();
    const res = await request(app).delete('/api/books/book-1');

    expect(res.status).toBe(204);
    expect(deleteBook).toHaveBeenCalledWith('test-user-id', 'book-1');
  });

  it('存在しない絵本の削除は404を返す', async () => {
    vi.mocked(deleteBook).mockResolvedValue(false);

    const app = createApp();
    const res = await request(app).delete('/api/books/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/books/:id/download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PDFをダウンロードできる', async () => {
    vi.mocked(getBookById).mockResolvedValue({
      id: 'book-1',
      title: 'たろうの冒険',
      profileId: 'profile-1',
      theme: 'adventure',
      pages: [
        { pageNumber: 1, text: 'ページ1', originalText: 'ページ1', imageUrl: 'https://example.com/p1.png' },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    vi.mocked(getProfileById).mockResolvedValue({
      id: 'profile-1',
      name: 'たろう',
      age: 5,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    const fakePdf = Buffer.from('%PDF-1.7 fake pdf content');
    vi.mocked(renderPdfWithRetry).mockResolvedValue(fakePdf);

    const app = createApp();
    const res = await request(app).get('/api/books/book-1/download');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('book-1.pdf');
    expect(renderPdfWithRetry).toHaveBeenCalled();
  });

  it('存在しない絵本は404を返す', async () => {
    vi.mocked(getBookById).mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get('/api/books/nonexistent/download');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('PDF生成失敗時は500を返す', async () => {
    vi.mocked(getBookById).mockResolvedValue({
      id: 'book-1',
      title: 'テスト',
      profileId: 'profile-1',
      theme: 'adventure',
      pages: [
        { pageNumber: 1, text: 'テスト', originalText: 'テスト', imageUrl: 'https://example.com/p1.png' },
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    vi.mocked(getProfileById).mockResolvedValue(null);
    vi.mocked(renderPdfWithRetry).mockRejectedValue(new Error('PDF generation failed'));

    const app = createApp();
    const res = await request(app).get('/api/books/book-1/download');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('PDF_GENERATION_ERROR');
  });
});
