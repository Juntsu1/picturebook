import { Router, type Request, type Response } from 'express';
import { CreateTemplateSchema } from '@picture-book/shared';
import { authMiddleware } from '../middleware/auth.js';
import {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  archiveTemplate,
} from '../services/template-service.js';

export const templatesRouter = Router();

// All template routes require authentication
templatesRouter.use(authMiddleware);

// GET /api/templates
templatesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const templates = await getTemplates(req.user!.userId);
    res.json({ templates });
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'テンプレート一覧の取得に失敗しました',
    });
  }
});

// POST /api/templates
templatesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: '入力内容に誤りがあります',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const userId = req.user!.userId;
    const template = await createTemplate(parsed.data, userId);
    res.status(201).json(template);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'テンプレートの作成に失敗しました';
    if (message.includes('validation failed')) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message,
      });
      return;
    }
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'テンプレートの作成に失敗しました',
    });
  }
});

// GET /api/templates/:id
templatesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const template = await getTemplateById(id);
    if (!template) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'テンプレートが見つかりません',
      });
      return;
    }
    res.json(template);
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'テンプレートの取得に失敗しました',
    });
  }
});

// PUT /api/templates/:id
templatesRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await updateTemplate(id, req.body);
    if (!updated) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'テンプレートが見つかりません',
      });
      return;
    }
    res.json(updated);
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'テンプレートの更新に失敗しました',
    });
  }
});

// DELETE /api/templates/:id (logical delete — archive)
templatesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const archived = await archiveTemplate(id);
    if (!archived) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'テンプレートが見つかりません',
      });
      return;
    }
    res.status(204).send();
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'テンプレートの削除に失敗しました',
    });
  }
});
