import { Router, type Request, type Response } from 'express';
import { ChatMessageSchema } from '@picture-book/shared';
import type { CharacterSummary } from '@picture-book/shared';
import { authMiddleware } from '../middleware/auth.js';
import {
  createSession,
  getSession,
  getSessions,
  sendMessage,
  generateDraft,
  saveDraftAsTemplate,
} from '../services/chat-story-service.js';
import { getCharacters } from '../services/character-service.js';

export const chatStoriesRouter = Router();

// All chat-story routes require authentication
chatStoriesRouter.use(authMiddleware);

// POST /api/chat-stories/sessions
chatStoriesRouter.post('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    let characters: CharacterSummary[] = req.body.characters;

    if (!characters || !Array.isArray(characters) || characters.length === 0) {
      // Fetch from character-service
      const registered = await getCharacters(userId);
      characters = registered.map((c) => ({
        characterId: c.id,
        name: c.name,
        role: c.role,
        age: c.age,
      }));
    }

    const sessionId = await createSession(userId, characters);
    res.status(201).json({ sessionId });
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'チャットセッションの作成に失敗しました',
    });
  }
});

// GET /api/chat-stories/sessions
chatStoriesRouter.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await getSessions(req.user!.userId);
    res.json({ sessions });
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'セッション一覧の取得に失敗しました',
    });
  }
});

// GET /api/chat-stories/sessions/:id
chatStoriesRouter.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = await getSession(req.user!.userId, id);
    if (!session) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'セッションが見つかりません',
      });
      return;
    }
    res.json(session);
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'セッションの取得に失敗しました',
    });
  }
});

// POST /api/chat-stories/sessions/:id/messages (SSE response)
chatStoriesRouter.post('/sessions/:id/messages', async (req: Request, res: Response) => {
  const parsed = ChatMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const userId = req.user!.userId;
  const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await sendMessage(userId, sessionId, parsed.data.message, res);
  } catch {
    // sendMessage handles its own SSE error events and res.end()
  }
});

// POST /api/chat-stories/sessions/:id/draft
chatStoriesRouter.post('/sessions/:id/draft', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const draft = await generateDraft(userId, sessionId);
    res.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ドラフト生成に失敗しました';
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message,
    });
  }
});

// POST /api/chat-stories/sessions/:id/save
chatStoriesRouter.post('/sessions/:id/save', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const isPublic = req.body.isPublic === true;
    const templateId = await saveDraftAsTemplate(userId, sessionId, isPublic);
    res.json({ templateId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'テンプレートの保存に失敗しました';
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message,
    });
  }
});
