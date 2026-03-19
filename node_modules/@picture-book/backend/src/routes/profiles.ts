import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { CreateProfileSchema, PHOTO_MAX_SIZE_BYTES } from '@picture-book/shared';
import { authMiddleware } from '../middleware/auth.js';
import {
  createProfile,
  getProfiles,
  getProfileById,
  updateProfilePhoto,
  clearProfilePhoto,
} from '../services/profile-service.js';
import {
  validatePhoto,
  uploadPhoto,
  deletePhoto,
} from '../services/photo-upload-service.js';

export const profilesRouter = Router();

// Configure multer with memory storage, single file 'photo', limit 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_SIZE_BYTES },
});

// All profile routes require authentication
profilesRouter.use(authMiddleware);

// POST /api/profiles (multipart/form-data support)
profilesRouter.post('/', upload.single('photo'), async (req: Request, res: Response) => {
  // Parse form fields: age needs to be converted from string to number
  const formData = {
    name: req.body.name,
    age: req.body.age !== undefined ? Number(req.body.age) : undefined,
    gender: req.body.gender || undefined,
    favoriteColor: req.body.favoriteColor || undefined,
    favoriteAnimal: req.body.favoriteAnimal || undefined,
    appearance: req.body.appearance || undefined,
  };

  const parsed = CreateProfileSchema.safeParse(formData);
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
    const file = req.file;

    if (file) {
      // Validate photo
      const validation = validatePhoto({ mimetype: file.mimetype, size: file.size });
      if (!validation.valid) {
        res.status(400).json({
          code: 'INVALID_FILE_TYPE',
          message: validation.error,
        });
        return;
      }

      // Create profile first to get the ID, then upload photo
      // We need a temporary profile to get the ID for the storage path
      const tempProfile = await createProfile(userId, parsed.data);

      try {
        // Upload photo (includes content safety check)
        const uploadResult = await uploadPhoto(userId, tempProfile.id, file.buffer);

        // Update profile with photo info
        await updateProfilePhoto(userId, tempProfile.id, uploadResult.photoUrl, uploadResult.storagePath);

        // Return profile with photo URL
        res.status(201).json({ ...tempProfile, photoUrl: uploadResult.photoUrl });
      } catch (uploadError) {
        // If photo upload fails, still return the created profile (without photo)
        if (uploadError instanceof Error && uploadError.name === 'PhotoUploadError') {
          res.status(400).json({
            code: 'CONTENT_UNSAFE',
            message: uploadError.message,
          });
          return;
        }
        throw uploadError;
      }
    } else {
      // No photo: create profile as before
      const profile = await createProfile(userId, parsed.data);
      res.status(201).json(profile);
    }
  } catch (err) {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'プロフィールの作成に失敗しました',
    });
  }
});

// GET /api/profiles
profilesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const profiles = await getProfiles(req.user!.userId);
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'プロフィール一覧の取得に失敗しました',
    });
  }
});

// GET /api/profiles/:id
profilesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const profile = await getProfileById(req.user!.userId, id);
    if (!profile) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'プロフィールが見つかりません',
      });
      return;
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'プロフィールの取得に失敗しました',
    });
  }
});

// PUT /api/profiles/:id/photo - Replace profile photo
profilesRouter.put('/:id/photo', upload.single('photo'), async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    // Check profile exists
    const profile = await getProfileById(userId, profileId);
    if (!profile) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'プロフィールが見つかりません',
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

    // Validate photo
    const validation = validatePhoto({ mimetype: file.mimetype, size: file.size });
    if (!validation.valid) {
      res.status(400).json({
        code: 'INVALID_FILE_TYPE',
        message: validation.error,
      });
      return;
    }

    // If profile already has a photo, delete old one first
    // We need to get the raw profile doc to check photoStoragePath
    // Since ProfileResponse doesn't include photoStoragePath, we use getProfileRawById
    // For now, we always try to delete the old photo (deletePhoto is idempotent-ish)
    try {
      await deletePhoto(userId, profileId);
    } catch {
      // Old photo may not exist, that's fine
    }

    // Upload new photo (includes content safety check)
    const uploadResult = await uploadPhoto(userId, profileId, file.buffer);

    // Update profile with new photo info
    await updateProfilePhoto(userId, profileId, uploadResult.photoUrl, uploadResult.storagePath);

    res.json({ photoUrl: uploadResult.photoUrl });
  } catch (err) {
    if (err instanceof Error && err.name === 'PhotoUploadError') {
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

// DELETE /api/profiles/:id/photo - Delete profile photo
profilesRouter.delete('/:id/photo', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  try {
    // Check profile exists
    const profile = await getProfileById(userId, profileId);
    if (!profile) {
      res.status(404).json({
        code: 'NOT_FOUND',
        message: 'プロフィールが見つかりません',
      });
      return;
    }

    // Delete photo from storage if it exists
    if (profile.photoUrl) {
      try {
        await deletePhoto(userId, profileId);
      } catch {
        // Storage deletion failure is non-fatal
      }
    }

    // Clear profile photo fields
    await clearProfilePhoto(userId, profileId);

    res.status(204).send();
  } catch (err) {
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: '写真の削除に失敗しました',
    });
  }
});
