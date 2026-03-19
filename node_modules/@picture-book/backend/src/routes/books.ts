import { Router, type Request, type Response } from 'express';
import { GenerateBookSchema, UpdatePageSchema, GenerateMultiBookSchema } from '@picture-book/shared';
import type { ProgressEvent, MultiProgressEvent, Theme, CharacterProfile } from '@picture-book/shared';
import { authMiddleware } from '../middleware/auth.js';
import { getProfileById, getProfileRawById } from '../services/profile-service.js';
import { generateStory, generateStoryFromTemplate } from '../services/story-engine.js';
import { checkText } from '../services/content-filter.js';
import { generateForPage, describeChildAppearance, generateCharacterSheet, generateForPageMultiCharacter } from '../services/illustration-engine.js';
import {
  createBook,
  savePages,
  updateBookStatus,
  getBooks,
  getBookById,
  updatePage,
  deleteBook,
} from '../services/book-service.js';
import { renderPdfWithRetry } from '../services/pdf-renderer.js';
import { getStorage } from 'firebase-admin/storage';
import { getTemplateById } from '../services/template-service.js';
import { getCharacterById } from '../services/character-service.js';
import { downloadPhoto } from '../services/photo-upload-service.js';

export const booksRouter = Router();

// All book routes require authentication
booksRouter.use(authMiddleware);

// --- Idempotency support ---
// Maps requestId → { bookId, status, sseClients }
// Prevents duplicate book creation when React StrictMode re-fires POST requests.
interface InFlightRequest {
  bookId?: string;
  status: 'processing' | 'completed' | 'error';
  sseClients: Response[];
  events: string[]; // buffered SSE events for late joiners
}
const inFlightRequests = new Map<string, InFlightRequest>();

// Clean up old entries after 10 minutes
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
function scheduleCleanup(requestId: string) {
  setTimeout(() => inFlightRequests.delete(requestId), IDEMPOTENCY_TTL_MS);
}

function broadcastSSE(entry: InFlightRequest, event: ProgressEvent | MultiProgressEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  entry.events.push(data);
  for (const client of entry.sseClients) {
    try { client.write(data); } catch { /* client disconnected */ }
  }
}

function endAllClients(entry: InFlightRequest) {
  for (const client of entry.sseClients) {
    try { client.end(); } catch { /* ignore */ }
  }
  entry.sseClients = [];
}

function sendSSE(res: Response, event: ProgressEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendMultiSSE(res: Response, event: MultiProgressEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// POST /api/books/generate-multi
booksRouter.post('/generate-multi', async (req: Request, res: Response) => {
  const parsed = GenerateMultiBookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const userId = req.user!.userId;
  const { templateId, characterAssignments, pageCount, requestId } = parsed.data;

  // --- Idempotency: check AND register atomically ---
  let entry: InFlightRequest | undefined;
  if (requestId) {
    const existing = inFlightRequests.get(requestId);
    if (existing) {
      // Duplicate request — join as SSE listener
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      // Replay buffered events
      for (const ev of existing.events) {
        try { res.write(ev); } catch { /* ignore */ }
      }
      if (existing.status === 'completed' || existing.status === 'error') {
        res.end();
      } else {
        existing.sseClients.push(res);
      }
      return;
    }
    // Register immediately to block concurrent duplicates
    entry = { status: 'processing', sseClients: [], events: [] };
    inFlightRequests.set(requestId, entry);
    scheduleCleanup(requestId);
  }

  // 1. Get template
  const template = await getTemplateById(templateId);
  if (!template) {
    if (requestId) inFlightRequests.delete(requestId);
    res.status(404).json({
      code: 'NOT_FOUND',
      message: 'テンプレートが見つかりません',
    });
    return;
  }

  // 2. Validate: no duplicate characterIds
  const characterIds = Object.values(characterAssignments);
  const uniqueIds = new Set(characterIds);
  if (uniqueIds.size !== characterIds.length) {
    if (requestId) inFlightRequests.delete(requestId);
    res.status(400).json({
      code: 'DUPLICATE_ASSIGNMENT',
      message: '同一キャラクターを複数のロールに割り当てることはできません',
    });
    return;
  }

  // 3. Validate: all required roles assigned
  const requiredRoles = template.roles.filter((r) => r.required).map((r) => r.role);
  const missingRoles = requiredRoles.filter((role) => !characterAssignments[role]);
  if (missingRoles.length > 0) {
    if (requestId) inFlightRequests.delete(requestId);
    res.status(400).json({
      code: 'MISSING_REQUIRED_ROLES',
      message: `必須ロールが未割り当てです: ${missingRoles.join(', ')}`,
    });
    return;
  }

  // 4. Get all assigned characters
  const characterProfiles = new Map<string, CharacterProfile>();
  for (const [role, characterId] of Object.entries(characterAssignments)) {
    const character = await getCharacterById(userId, characterId);
    if (!character) {
      if (requestId) inFlightRequests.delete(requestId);
      res.status(404).json({
        code: 'NOT_FOUND',
        message: `キャラクターが見つかりません: ${characterId}`,
      });
      return;
    }
    characterProfiles.set(role, {
      name: character.name,
      role: character.role as CharacterProfile['role'],
      age: character.age,
      gender: character.gender,
      appearance: character.appearance,
      photoStoragePath: null,
      photoUrl: character.photoUrl,
      characterSheetPath: null,
      characterSheetStatus: character.characterSheetStatus,
      appearanceDescription: null,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add this response as SSE client to the entry
  if (entry) {
    entry.sseClients.push(res);
  }

  const emitMulti = (event: MultiProgressEvent) => {
    if (entry) {
      broadcastSSE(entry, event);
    } else {
      sendMultiSSE(res, event);
    }
  };

  let bookId: string | undefined;

  try {
    // Step 1: Generate story from template
    emitMulti({ type: 'story_generating' });

    const story = await generateStoryFromTemplate(
      template as unknown as import('@picture-book/shared').StoryTemplate,
      characterProfiles,
      undefined,
      pageCount
    );

    // Step 2: Content check
    const fullText = story.pages.map((p) => p.text).join('\n');
    const contentCheck = await checkText(fullText);
    if (!contentCheck.safe) {
      emitMulti({
        type: 'error',
        message: '生成されたストーリーに不適切なコンテンツが含まれています。再試行してください。',
        retryable: true,
      });
      if (entry) { entry.status = 'error'; endAllClients(entry); } else { res.end(); }
      return;
    }

    emitMulti({
      type: 'story_complete',
      title: story.title,
      pageCount: story.pages.length,
    });

    // Step 3: Create book record
    const protagonistId = characterAssignments['protagonist'] ?? characterIds[0];
    bookId = await createBook(userId, {
      profileId: protagonistId,
      title: story.title,
      theme: template.theme,
    });

    // Step 4: Check character sheets and prepare character data
    emitMulti({ type: 'character_sheets_checking' });

    const charactersMap = new Map<string, { profile: CharacterProfile; photoBuffer?: Buffer; characterSheetBuffer?: Buffer }>();

    for (const [role, profile] of characterProfiles.entries()) {
      const charData: { profile: CharacterProfile; photoBuffer?: Buffer; characterSheetBuffer?: Buffer } = { profile };

      if (profile.photoUrl) {
        // Try to download photo
        const charId = characterAssignments[role];
        const photoPath = `users/${userId}/characters/${charId}/photo.png`;
        try {
          charData.photoBuffer = await downloadPhoto(photoPath);
        } catch {
          // Photo download failed, continue without
        }

        // Try to download character sheet
        if (profile.characterSheetStatus === 'completed') {
          const sheetPath = `users/${userId}/characters/${charId}/character_sheet.png`;
          try {
            charData.characterSheetBuffer = await downloadPhoto(sheetPath);
          } catch {
            // Sheet download failed, continue without
          }
        }
      }

      charactersMap.set(role, charData);
    }

    // Step 5: Generate illustrations for each page
    const completedPages: { pageNumber: number; text: string; imageUrl: string }[] = [];

    for (const page of story.pages) {
      emitMulti({
        type: 'illustration_generating',
        pageNumber: page.pageNumber,
        totalPages: story.pages.length,
      });

      // Determine which roles appear on this page
      const templatePage = template.pages.find((p) => p.pageNumber === page.pageNumber);
      const pageRoles = templatePage?.roles ?? Object.keys(characterAssignments);

      const illustration = await generateForPageMultiCharacter(
        page,
        charactersMap,
        pageRoles,
        template.theme as Theme,
        { userId, bookId }
      );

      completedPages.push({
        pageNumber: page.pageNumber,
        text: page.text,
        imageUrl: illustration.imageUrl,
      });

      emitMulti({
        type: 'illustration_complete',
        pageNumber: page.pageNumber,
      });
    }

    // Step 6: Save pages
    await savePages(userId, bookId, completedPages);

    // Step 7: Update book status
    const thumbnailUrl = completedPages[0]?.imageUrl ?? null;
    await updateBookStatus(userId, bookId, 'completed', thumbnailUrl ?? undefined);

    // Step 8: Send completion event
    emitMulti({ type: 'complete', bookId });
    if (entry) { entry.status = 'completed'; endAllClients(entry); } else { res.end(); }
  } catch (error) {
    const message = error instanceof Error ? error.message : '絵本の生成中にエラーが発生しました';
    const retryable = (error as { retryable?: boolean }).retryable ?? true;

    if (bookId) {
      try {
        await updateBookStatus(userId, bookId, 'error');
      } catch {
        // Ignore status update failure
      }
    }

    emitMulti({ type: 'error', message, retryable });
    if (entry) { entry.status = 'error'; endAllClients(entry); } else { res.end(); }
  }
});

// POST /api/books/generate
booksRouter.post('/generate', async (req: Request, res: Response) => {
  console.log('[generate] リクエスト受信:', JSON.stringify(req.body));

  const parsed = GenerateBookSchema.safeParse(req.body);
  if (!parsed.success) {
    console.log('[generate] バリデーションエラー:', JSON.stringify(parsed.error.flatten()));
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const userId = req.user!.userId;
  const { profileId, theme, pageCount, requestId } = parsed.data;
  console.log(`[generate] userId=${userId}, profileId=${profileId}, theme=${theme}, requestId=${requestId ?? 'none'}`);

  // --- Idempotency: check AND register atomically ---
  // Must register before any async work to prevent race conditions.
  let entry: InFlightRequest | undefined;
  if (requestId) {
    const existing = inFlightRequests.get(requestId);
    if (existing) {
      console.log(`[generate] 冪等性: requestId=${requestId} は処理中 → SSE合流`);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      for (const ev of existing.events) {
        try { res.write(ev); } catch { /* ignore */ }
      }
      if (existing.status === 'completed' || existing.status === 'error') {
        res.end();
      } else {
        existing.sseClients.push(res);
      }
      return;
    }
    // Register immediately to block concurrent duplicates
    entry = { status: 'processing', sseClients: [], events: [] };
    inFlightRequests.set(requestId, entry);
    scheduleCleanup(requestId);
    console.log(`[generate] 冪等性: requestId=${requestId} を登録`);
  }

  // Fetch profile (raw to get photoStoragePath)
  const profile = await getProfileRawById(userId, profileId);
  if (!profile) {
    console.log('[generate] プロフィールが見つかりません');
    if (requestId) inFlightRequests.delete(requestId);
    res.status(404).json({
      code: 'NOT_FOUND',
      message: 'プロフィールが見つかりません',
    });
    return;
  }
  console.log(`[generate] プロフィール取得OK: name=${profile.name}, age=${profile.age}`);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add this response as SSE client to the entry
  if (entry) {
    entry.sseClients.push(res);
  }

  const emit = (event: ProgressEvent) => {
    if (entry) {
      broadcastSSE(entry, event);
    } else {
      sendSSE(res, event);
    }
  };

  let bookId: string | undefined;

  try {
    // Step 1: Generate story
    console.log('[generate] Step1: ストーリー生成開始...');
    emit({ type: 'story_generating' });

    const storyStart = Date.now();
    const story = await generateStory(
      {
        name: profile.name,
        age: profile.age,
        gender: profile.gender ?? null,
        favoriteColor: profile.favoriteColor ?? null,
        favoriteAnimal: profile.favoriteAnimal ?? null,
        appearance: profile.appearance ?? null,
      },
      theme as Theme,
      undefined,
      pageCount
    );
    console.log(`[generate] Step1完了: title="${story.title}", pages=${story.pages.length}, ${Date.now() - storyStart}ms`);

    // Step 2: Content check on full story text
    console.log('[generate] Step2: コンテンツチェック開始...');
    const fullText = story.pages.map((p) => p.text).join('\n');
    const contentCheck = await checkText(fullText);
    console.log(`[generate] Step2完了: safe=${contentCheck.safe}`);
    if (!contentCheck.safe) {
      emit({
        type: 'error',
        message: '生成されたストーリーに不適切なコンテンツが含まれています。再試行してください。',
        retryable: true,
      });
      if (entry) { entry.status = 'error'; endAllClients(entry); } else { res.end(); }
      return;
    }

    emit({
      type: 'story_complete',
      title: story.title,
      pageCount: story.pages.length,
    });

    // Step 3: Create book record in Firestore
    console.log('[generate] Step3: Firestoreにブック作成...');
    bookId = await createBook(userId, {
      profileId,
      title: story.title,
      theme,
    });
    console.log(`[generate] Step3完了: bookId=${bookId}`);

    // Step 4: Generate illustrations for each page
    // If photo exists, generate character sheet + analyze appearance once for all pages
    let appearanceDescription: string | undefined;
    let characterSheetBuffer: Buffer | undefined;
    if (profile.photoStoragePath) {
      try {
        const { createOpenAIClient } = await import('../lib/openai.js');
        const { downloadPhoto } = await import('../services/photo-upload-service.js');
        const client = createOpenAIClient();
        const photoBuffer = await downloadPhoto(profile.photoStoragePath);

        // Step 4a: Analyze child's appearance with GPT-4o vision
        console.log('[generate] 写真から外見を分析中...');
        appearanceDescription = await describeChildAppearance(client, photoBuffer);
        console.log(`[generate] 外見分析完了: ${appearanceDescription.slice(0, 100)}...`);

        // Step 4b: Generate character sheet (multiple poses/expressions)
        console.log('[generate] キャラクターシート生成中...');
        emit({ type: 'story_generating' }); // reuse event to show progress
        const sheetStart = Date.now();
        characterSheetBuffer = await generateCharacterSheet(
          client,
          photoBuffer,
          {
            name: profile.name,
            age: profile.age,
            gender: profile.gender ?? null,
            favoriteColor: profile.favoriteColor ?? null,
            favoriteAnimal: profile.favoriteAnimal ?? null,
            appearance: profile.appearance ?? null,
          },
          appearanceDescription
        );
        console.log(`[generate] キャラクターシート生成完了: ${Date.now() - sheetStart}ms`);
      } catch (err) {
        console.warn('[generate] 外見分析/キャラクターシート生成失敗、スキップ:', err instanceof Error ? err.message : err);
      }
    }

    const completedPages: { pageNumber: number; text: string; imageUrl: string }[] = [];

    for (const page of story.pages) {
      console.log(`[generate] Step4: イラスト生成 page ${page.pageNumber}/${story.pages.length}...`);
      emit({
        type: 'illustration_generating',
        pageNumber: page.pageNumber,
        totalPages: story.pages.length,
      });

      const illuStart = Date.now();
      const illustration = await generateForPage(
        page,
        {
          name: profile.name,
          age: profile.age,
          gender: profile.gender ?? null,
          favoriteColor: profile.favoriteColor ?? null,
          favoriteAnimal: profile.favoriteAnimal ?? null,
          appearance: profile.appearance ?? null,
        },
        theme as Theme,
        { userId, bookId, photoStoragePath: profile.photoStoragePath, appearanceDescription, characterSheetBuffer }
      );
      console.log(`[generate] イラスト page ${page.pageNumber} 完了: ${Date.now() - illuStart}ms`);

      completedPages.push({
        pageNumber: page.pageNumber,
        text: page.text,
        imageUrl: illustration.imageUrl,
      });

      emit({
        type: 'illustration_complete',
        pageNumber: page.pageNumber,
      });
    }

    // Step 5: Save pages to Firestore
    console.log('[generate] Step5: ページ保存...');
    await savePages(userId, bookId, completedPages);

    // Step 6: Save thumbnail (use first page illustration)
    console.log('[generate] Step6: サムネイル保存...');
    const thumbnailUrl = completedPages[0]?.imageUrl ?? null;
    await updateBookStatus(userId, bookId, 'completed', thumbnailUrl ?? undefined);

    // Step 7: Send completion event
    console.log('[generate] Step7: 完了！');
    emit({ type: 'complete', bookId });
    if (entry) { entry.status = 'completed'; endAllClients(entry); } else { res.end(); }
  } catch (error) {
    console.error('[generate] エラー発生:', error);
    const message = error instanceof Error ? error.message : '絵本の生成中にエラーが発生しました';
    const retryable = (error as { retryable?: boolean }).retryable ?? true;

    // Update book status to error if we created one
    if (bookId) {
      try {
        await updateBookStatus(userId, bookId, 'error');
      } catch {
        // Ignore status update failure
      }
    }

    emit({ type: 'error', message, retryable });
    if (entry) { entry.status = 'error'; endAllClients(entry); } else { res.end(); }
  }
});

// GET /api/books
booksRouter.get('/', async (req: Request, res: Response) => {
  try {
    const books = await getBooks(req.user!.userId);
    res.json({ books });
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: '絵本一覧の取得に失敗しました',
    });
  }
});

// GET /api/books/:id
booksRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const book = await getBookById(req.user!.userId, id);
    if (!book) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: '絵本が見つかりません',
      });
      return;
    }
    res.json(book);
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: '絵本の取得に失敗しました',
    });
  }
});

// PUT /api/books/:id/pages/:pageNumber
booksRouter.put('/:id/pages/:pageNumber', async (req: Request, res: Response) => {
  const parsed = UpdatePageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const userId = req.user!.userId;
  const bookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const pageNumber = Number(
    Array.isArray(req.params.pageNumber) ? req.params.pageNumber[0] : req.params.pageNumber
  );

  if (Number.isNaN(pageNumber) || pageNumber < 1) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '無効なページ番号です',
    });
    return;
  }

  try {
    // Content safety check
    const contentCheck = await checkText(parsed.data.text);
    if (!contentCheck.safe) {
      res.status(400).json({
        code: 'CONTENT_UNSAFE',
        message: '不適切な表現が含まれています。内容を修正してください。',
        details: { flaggedCategories: contentCheck.flaggedCategories },
      });
      return;
    }

    const updated = await updatePage(userId, bookId, pageNumber, parsed.data.text);
    if (!updated) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: '指定されたページが見つかりません',
      });
      return;
    }

    res.json({ message: 'ページを更新しました' });
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'ページの更新に失敗しました',
    });
  }
});

// GET /api/books/:id/download
booksRouter.get('/:id/download', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const bookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const book = await getBookById(userId, bookId);
    if (!book) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: '絵本が見つかりません',
      });
      return;
    }

    const bookData = {
      id: book.id,
      title: book.title,
      theme: book.theme as Theme,
      pages: book.pages.map((p) => ({
        pageNumber: p.pageNumber,
        text: p.text,
        originalText: p.originalText,
        imageUrl: p.imageUrl,
      })),
      profile: { name: '', age: 0 },
    };

    // Try to get profile info for the title page
    try {
      const profile = await getProfileById(userId, book.profileId);
      if (profile) {
        bookData.profile = { name: profile.name, age: profile.age };
      }
    } catch {
      // Continue with empty profile if fetch fails
    }

    const pdfBuffer = await renderPdfWithRetry(bookData);

    // Save to Firebase Storage
    try {
      const bucket = getStorage().bucket();
      const filePath = `users/${userId}/books/${bookId}/output.pdf`;
      const file = bucket.file(filePath);
      await file.save(pdfBuffer, {
        metadata: { contentType: 'application/pdf' },
      });
    } catch {
      // Storage save failure is non-fatal; still return the PDF to the user
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${bookId}.pdf"`);
    res.send(pdfBuffer);
  } catch {
    res.status(500).json({
      code: 'PDF_GENERATION_ERROR',
      message: 'PDF の生成に失敗しました。再試行してください。',
    });
  }
});

// DELETE /api/books/:id
booksRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const bookId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const deleted = await deleteBook(userId, bookId);
    if (!deleted) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: '絵本が見つかりません',
      });
      return;
    }

    res.status(204).send();
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: '絵本の削除に失敗しました',
    });
  }
});
