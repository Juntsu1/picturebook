import { getStorage } from 'firebase-admin/storage';
import {
  PHOTO_MAX_SIZE_BYTES,
  PHOTO_ALLOWED_MIME_TYPES,
} from '@picture-book/shared';
import { checkImage, type ContentCheckResult } from './content-filter.js';

export interface PhotoValidationResult {
  valid: boolean;
  error?: string;
}

export interface PhotoUploadResult {
  photoUrl: string;
  storagePath: string;
}

export class PhotoUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoUploadError';
  }
}

type CheckImageFn = (imageUrl: string) => Promise<ContentCheckResult>;

type StorageBucket = {
  file: (path: string) => {
    save: (data: Buffer, opts: object) => Promise<void>;
    getSignedUrl: (opts: object) => Promise<string[]>;
    publicUrl: () => string;
    delete: () => Promise<unknown>;
    download: () => Promise<Buffer[]>;
  };
};

/**
 * ファイル形式・サイズのバリデーション
 */
export function validatePhoto(file: {
  mimetype: string;
  size: number;
}): PhotoValidationResult {
  const allowedTypes: readonly string[] = PHOTO_ALLOWED_MIME_TYPES;

  if (!allowedTypes.includes(file.mimetype)) {
    return {
      valid: false,
      error:
        '対応していないファイル形式です。JPEG、PNG、WebP のいずれかをアップロードしてください',
    };
  }

  if (file.size > PHOTO_MAX_SIZE_BYTES) {
    return {
      valid: false,
      error:
        'ファイルサイズが大きすぎます。10MB以下の画像をアップロードしてください',
    };
  }

  return { valid: true };
}

/**
 * 写真を Firebase Storage にアップロード
 * アップロード前にコンテンツフィルターで安全性チェックを実施
 */
export async function uploadPhoto(
  userId: string,
  profileId: string,
  fileBuffer: Buffer,
  options?: { storageBucket?: StorageBucket; checkImageFn?: CheckImageFn }
): Promise<PhotoUploadResult> {
  const checkFn = options?.checkImageFn ?? checkImage;

  // コンテンツ安全性チェック（Storage 保存前に実施）
  const base64Data = fileBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Data}`;
  const checkResult = await checkFn(dataUrl);

  if (!checkResult.safe) {
    throw new PhotoUploadError(
      'アップロードされた画像は使用できません。別の画像をお試しください'
    );
  }

  const bucket = options?.storageBucket ?? getStorage().bucket();
  const storagePath = `users/${userId}/profiles/${profileId}/photo.png`;
  const file = bucket.file(storagePath);

  await file.save(fileBuffer, {
    metadata: {
      contentType: 'image/png',
    },
  });

  let photoUrl: string;
  try {
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    photoUrl = signedUrl;
  } catch {
    photoUrl = file.publicUrl();
  }

  return { photoUrl, storagePath };
}

/**
 * Firebase Storage から写真を削除
 */
export async function deletePhoto(
  userId: string,
  profileId: string,
  options?: { storageBucket?: StorageBucket }
): Promise<void> {
  const bucket = options?.storageBucket ?? getStorage().bucket();
  const storagePath = `users/${userId}/profiles/${profileId}/photo.png`;
  const file = bucket.file(storagePath);
  await file.delete();
}

/**
 * Firebase Storage から写真のバイナリを取得
 */
export async function downloadPhoto(
  storagePath: string,
  options?: { storageBucket?: StorageBucket }
): Promise<Buffer> {
  const bucket = options?.storageBucket ?? getStorage().bucket();
  const file = bucket.file(storagePath);
  const [data] = await file.download();
  return data;
}
