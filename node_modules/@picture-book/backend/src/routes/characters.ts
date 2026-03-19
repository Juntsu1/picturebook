import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import {
  CreateCharacterSchema,
  UpdateCharacterSchema,
  PHOTO_MAX_SIZE_BYTES,
} from '@picture-book/shared';
import { authMiddleware } from '../middleware/auth.js';
import {
  createCharacter,
  getCharacters,
  getCharacterById,
  updateCharacter,
  deleteCharacter,
  uploadCharacterPhoto,
  replaceCharacterPhoto,
  generateCharacterSheetForCharacter,
  CharacterServiceError,
} from '../services/character-service.js';
import { validatePhoto } from '../services/photo-upload-service.js';

export const charactersRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_SIZE_BYTES },
});

// All character routes require authentication
charactersRouter.use(authMiddleware);

// GET /api/characters
charactersRouter.get('/', async (req: Request, res: Response) => {
  try {
    const characters = await getCharacters(req.user!.userId);
    res.json({ characters });
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'キャラクター一覧の取得に失敗しました',
    });
  }
});

// POST /api/characters
charactersRouter.post('/', upload.single('photo'), async (req: Request, res: Response) => {
  const formData = {
    name: req.body.name,
    role: req.body.role,
    age: req.body.age !== undefined ? Number(req.body.age) : undefined,
    gender: req.body.gender || undefined,
    appearance: req.body.appearance || undefined,
  };

  const parsed = CreateCharacterSchema.safeParse(formData);
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
    const character = await createCharacter(userId, parsed.data);

    const file = req.file;
    if (file) {
      const validation = validatePhoto({ mimetype: file.mimetype, size: file.size });
      if (!validation.valid) {
        res.status(201).json(character);
        return;
      }

      try {
        await uploadCharacterPhoto(userId, character.id, file.buffer);
        const updated = await getCharacterById(userId, character.id);
        res.status(201).json(updated ?? character);
      } catch (uploadError) {
        if (uploadError instanceof CharacterServiceError && uploadError.code === 'CONTENT_UNSAFE') {
          res.status(400).json({
            code: 'CONTENT_UNSAFE',
            message: uploadError.message,
          });
          return;
        }
        // Return character without photo on upload failure
        res.status(201).json(character);
      }
    } else {
      res.status(201).json(character);
    }
  } catch (err) {
    if (err instanceof CharacterServiceError && err.code === 'LIMIT_EXCEEDED') {
      res.status(400).json({
        code: 'LIMIT_EXCEEDED',
        message: err.message,
      });
      return;
    }
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'キャラクターの作成に失敗しました',
    });
  }
});

// GET /api/characters/:id
charactersRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const character = await getCharacterById(req.user!.userId, id);
    if (!character) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'キャラクターが見つかりません',
      });
      return;
    }
    res.json(character);
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'キャラクターの取得に失敗しました',
    });
  }
});

// PUT /api/characters/:id
charactersRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = UpdateCharacterSchema.safeParse(req.body);
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
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updated = await updateCharacter(userId, id, parsed.data);
    if (!updated) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'キャラクターが見つかりません',
      });
      return;
    }
    res.json(updated);
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'キャラクターの更新に失敗しました',
    });
  }
});

// DELETE /api/characters/:id
charactersRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const deleted = await deleteCharacter(userId, id);
    if (!deleted) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'キャラクターが見つかりません',
      });
      return;
    }
    res.status(204).send();
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'キャラクターの削除に失敗しました',
    });
  }
});

// PUT /api/characters/:id/photo
charactersRouter.put('/:id/photo', upload.single('photo'), async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const character = await getCharacterById(userId, id);
    if (!character) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'キャラクターが見つかりません',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: '写真ファイルが必要です',
      });
      return;
    }

    const validation = validatePhoto({ mimetype: file.mimetype, size: file.size });
    if (!validation.valid) {
      res.status(400).json({
        code: 'INVALID_FILE_TYPE',
        message: validation.error,
      });
      return;
    }

    const result = await replaceCharacterPhoto(userId, id, file.buffer);
    res.json({ photoUrl: result.photoUrl });
  } catch (err) {
    if (err instanceof CharacterServiceError && err.code === 'CONTENT_UNSAFE') {
      res.status(400).json({
        code: 'CONTENT_UNSAFE',
        message: err.message,
      });
      return;
    }
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: '写真のアップロードに失敗しました',
    });
  }
});

// POST /api/characters/:id/regenerate-sheet
charactersRouter.post('/:id/regenerate-sheet', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    const character = await getCharacterById(userId, id);
    if (!character) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'キャラクターが見つかりません',
      });
      return;
    }

    if (!character.photoUrl) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: '写真が登録されていません。先に写真をアップロードしてください。',
      });
      return;
    }

    // Trigger regeneration (async)
    generateCharacterSheetForCharacter(userId, id).catch((err) => {
      console.error(`[characters] Sheet regeneration failed for ${id}:`, err);
    });

    res.json({ message: 'キャラクターシートの再生成を開始しました' });
  } catch {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'キャラクターシートの再生成に失敗しました',
    });
  }
});
