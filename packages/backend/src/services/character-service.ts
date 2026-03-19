import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import OpenAI from 'openai';
import { getDb } from '../lib/firebase.js';
import { createOpenAIClient } from '../lib/openai.js';
import { MAX_CHARACTERS_PER_USER } from '@picture-book/shared';
import { checkImage, type ContentCheckResult } from './content-filter.js';
import { describeChildAppearance, generateCharacterSheet } from './illustration-engine.js';

// --- Types ---

export interface CharacterResponse {
  id: string;
  name: string;
  role: string;
  age: number | null;
  gender: string | null;
  appearance: string | null;
  photoUrl: string | null;
  characterSheetUrl: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterInput {
  name: string;
  role: string;
  age?: number;
  gender?: string;
  appearance?: string;
}

export interface UpdateCharacterInput {
  name?: string;
  role?: string;
  age?: number;
  gender?: string;
  appearance?: string;
}

export interface PhotoUploadResult {
  photoUrl: string;
  storagePath: string;
}

export class CharacterServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CharacterServiceError';
  }
}

type StorageBucket = {
  file: (path: string) => {
    save: (data: Buffer, opts: object) => Promise<void>;
    getSignedUrl: (opts: object) => Promise<string[]>;
    publicUrl: () => string;
    delete: () => Promise<unknown>;
    download: () => Promise<Buffer[]>;
  };
};

type CheckImageFn = (imageUrl: string) => Promise<ContentCheckResult>;

// --- Helpers ---

function getCharactersCollection(userId: string) {
  return getDb().collection('users').doc(userId).collection('characters');
}

interface CharacterDoc {
  name: string;
  role: string;
  age: number | null;
  gender: string | null;
  appearance: string | null;
  photoStoragePath: string | null;
  photoUrl: string | null;
  characterSheetPath: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
  appearanceDescription: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

async function toCharacterResponse(id: string, doc: CharacterDoc, bucket?: ReturnType<ReturnType<typeof getStorage>['bucket']>): Promise<CharacterResponse> {
  let characterSheetUrl: string | null = null;
  if (doc.characterSheetPath && doc.characterSheetStatus === 'completed') {
    try {
      const b = bucket ?? getStorage().bucket();
      const sheetFile = b.file(doc.characterSheetPath);
      const [signedUrl] = await sheetFile.getSignedUrl({
        action: 'read',
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      characterSheetUrl = signedUrl;
    } catch {
      // fallback: no URL
    }
  }
  return {
    id,
    name: doc.name,
    role: doc.role,
    age: doc.age,
    gender: doc.gender,
    appearance: doc.appearance,
    photoUrl: doc.photoUrl,
    characterSheetUrl,
    characterSheetStatus: doc.characterSheetStatus,
    createdAt: doc.createdAt.toDate().toISOString(),
    updatedAt: doc.updatedAt.toDate().toISOString(),
  };
}

// --- CRUD Operations ---

export async function createCharacter(
  userId: string,
  data: CreateCharacterInput
): Promise<CharacterResponse> {
  // Check character limit
  const snapshot = await getCharactersCollection(userId).get();
  if (snapshot.size >= MAX_CHARACTERS_PER_USER) {
    throw new CharacterServiceError(
      `キャラクター登録数が上限（${MAX_CHARACTERS_PER_USER}件）に達しています`,
      'LIMIT_EXCEEDED'
    );
  }

  const now = Timestamp.now();
  const doc: CharacterDoc = {
    name: data.name,
    role: data.role,
    age: data.age ?? null,
    gender: data.gender ?? null,
    appearance: data.appearance ?? null,
    photoStoragePath: null,
    photoUrl: null,
    characterSheetPath: null,
    characterSheetStatus: 'none',
    appearanceDescription: null,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await getCharactersCollection(userId).add(doc);
  return toCharacterResponse(ref.id, doc);
}

export async function getCharacters(userId: string): Promise<CharacterResponse[]> {
  const snapshot = await getCharactersCollection(userId)
    .orderBy('createdAt', 'desc')
    .get();

  return Promise.all(snapshot.docs.map((d) =>
    toCharacterResponse(d.id, d.data() as CharacterDoc)
  ));
}

export async function getCharacterById(
  userId: string,
  characterId: string
): Promise<CharacterResponse | null> {
  const doc = await getCharactersCollection(userId).doc(characterId).get();
  if (!doc.exists) return null;
  return toCharacterResponse(doc.id, doc.data() as CharacterDoc);
}

export async function updateCharacter(
  userId: string,
  characterId: string,
  data: UpdateCharacterInput
): Promise<CharacterResponse | null> {
  const docRef = getCharactersCollection(userId).doc(characterId);
  const snap = await docRef.get();
  if (!snap.exists) return null;

  // Build update object — DO NOT change characterSheetPath or characterSheetStatus
  const update: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
  };
  if (data.name !== undefined) update.name = data.name;
  if (data.role !== undefined) update.role = data.role;
  if (data.age !== undefined) update.age = data.age;
  if (data.gender !== undefined) update.gender = data.gender;
  if (data.appearance !== undefined) update.appearance = data.appearance;

  await docRef.update(update);

  const updated = await docRef.get();
  return toCharacterResponse(updated.id, updated.data() as CharacterDoc);
}

export async function deleteCharacter(
  userId: string,
  characterId: string,
  options?: { storageBucket?: StorageBucket }
): Promise<boolean> {
  const docRef = getCharactersCollection(userId).doc(characterId);
  const snap = await docRef.get();
  if (!snap.exists) return false;

  // Cleanup Storage files (photo + character_sheet)
  const bucket = options?.storageBucket ?? getStorage().bucket();
  const filesToDelete = [
    `users/${userId}/characters/${characterId}/photo.png`,
    `users/${userId}/characters/${characterId}/character_sheet.png`,
  ];

  for (const filePath of filesToDelete) {
    try {
      await bucket.file(filePath).delete();
    } catch {
      // Ignore deletion errors (file may not exist)
    }
  }

  await docRef.delete();
  return true;
}

// --- Photo Upload & Character Sheet Generation ---

export async function uploadCharacterPhoto(
  userId: string,
  characterId: string,
  fileBuffer: Buffer,
  options?: {
    storageBucket?: StorageBucket;
    checkImageFn?: CheckImageFn;
    openaiClient?: OpenAI;
  }
): Promise<PhotoUploadResult> {
  const checkFn = options?.checkImageFn ?? checkImage;

  // Content filter check BEFORE saving
  const base64Data = fileBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Data}`;
  const checkResult = await checkFn(dataUrl);

  if (!checkResult.safe) {
    throw new CharacterServiceError(
      'アップロードされた画像は使用できません。別の画像をお試しください',
      'CONTENT_UNSAFE'
    );
  }

  const bucket = options?.storageBucket ?? getStorage().bucket();
  const storagePath = `users/${userId}/characters/${characterId}/photo.png`;
  const file = bucket.file(storagePath);

  await file.save(fileBuffer, {
    metadata: { contentType: 'image/png' },
  });

  // Get signed URL
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

  // Update character doc with photo info and set sheet status to generating
  const docRef = getCharactersCollection(userId).doc(characterId);
  await docRef.update({
    photoStoragePath: storagePath,
    photoUrl,
    characterSheetStatus: 'generating',
    updatedAt: Timestamp.now(),
  });

  // Trigger character sheet generation async (don't await)
  console.log(`[character-service] キャラクターシート生成をバックグラウンドで開始: ${characterId}`);
  generateCharacterSheetForCharacter(userId, characterId, {
    storageBucket: options?.storageBucket,
    openaiClient: options?.openaiClient,
  }).catch((err) => {
    console.error(`[character-service] Character sheet generation failed for ${characterId}:`, err);
  });

  return { photoUrl, storagePath };
}

export async function replaceCharacterPhoto(
  userId: string,
  characterId: string,
  fileBuffer: Buffer,
  options?: {
    storageBucket?: StorageBucket;
    checkImageFn?: CheckImageFn;
    openaiClient?: OpenAI;
  }
): Promise<PhotoUploadResult> {
  const bucket = options?.storageBucket ?? getStorage().bucket();

  // Delete existing photo + character sheet from Storage
  const filesToDelete = [
    `users/${userId}/characters/${characterId}/photo.png`,
    `users/${userId}/characters/${characterId}/character_sheet.png`,
  ];

  for (const filePath of filesToDelete) {
    try {
      await bucket.file(filePath).delete();
    } catch {
      // Ignore deletion errors (file may not exist)
    }
  }

  // Clear character sheet fields before re-upload
  const docRef = getCharactersCollection(userId).doc(characterId);
  await docRef.update({
    characterSheetPath: null,
    characterSheetStatus: 'none',
    appearanceDescription: null,
    updatedAt: Timestamp.now(),
  });

  // Upload new photo (which triggers sheet generation)
  return uploadCharacterPhoto(userId, characterId, fileBuffer, {
    storageBucket: bucket as StorageBucket,
    checkImageFn: options?.checkImageFn,
    openaiClient: options?.openaiClient,
  });
}

export async function generateCharacterSheetForCharacter(
  userId: string,
  characterId: string,
  options?: {
    storageBucket?: StorageBucket;
    openaiClient?: OpenAI;
  }
): Promise<void> {
  const client = options?.openaiClient ?? createOpenAIClient();
  const bucket = options?.storageBucket ?? getStorage().bucket();
  const docRef = getCharactersCollection(userId).doc(characterId);

  try {
    console.log(`[character-service] シート生成開始: ${characterId}`);
    const snap = await docRef.get();
    if (!snap.exists) { console.log(`[character-service] ドキュメントなし: ${characterId}`); return; }
    const charData = snap.data() as CharacterDoc;

    if (!charData.photoStoragePath) { console.log(`[character-service] 写真パスなし: ${characterId}`); return; }

    // Download photo from Storage
    console.log(`[character-service] 写真ダウンロード中: ${charData.photoStoragePath}`);
    const photoFile = bucket.file(charData.photoStoragePath);
    const [photoBuffer] = await photoFile.download();
    console.log(`[character-service] 写真ダウンロード完了: ${photoBuffer.length} bytes`);

    // Describe child appearance using GPT-4o Vision
    let appearanceDescription = '';
    try {
      console.log(`[character-service] GPT-4o Vision 外見記述開始...`);
      appearanceDescription = await describeChildAppearance(client, photoBuffer);
      console.log(`[character-service] GPT-4o Vision 外見記述完了: ${appearanceDescription.length} chars`);
    } catch (err) {
      console.warn(`[character-service] describeChildAppearance failed for ${characterId}, continuing without:`, err);
    }

    // Generate character sheet
    const profile = {
      name: charData.name,
      age: charData.age ?? 7,
    };
    console.log(`[character-service] キャラクターシート生成開始 (images.edit)...`);
    const sheetBuffer = await generateCharacterSheet(client, photoBuffer, profile, appearanceDescription || undefined);
    console.log(`[character-service] キャラクターシート生成完了: ${sheetBuffer.length} bytes`);

    // Save character sheet to Storage
    const sheetPath = `users/${userId}/characters/${characterId}/character_sheet.png`;
    const sheetFile = bucket.file(sheetPath);
    await sheetFile.save(sheetBuffer, {
      metadata: { contentType: 'image/png' },
    });
    console.log(`[character-service] シート保存完了: ${sheetPath}`);

    // Update character doc
    await docRef.update({
      characterSheetPath: sheetPath,
      characterSheetStatus: 'completed',
      appearanceDescription: appearanceDescription || null,
      updatedAt: Timestamp.now(),
    });
    console.log(`[character-service] ステータス更新完了: completed`);
  } catch (err) {
    // On failure, set status to 'failed' and log — do NOT throw
    console.error(`[character-service] Character sheet generation failed for ${characterId}:`, err);
    try {
      await docRef.update({
        characterSheetStatus: 'failed',
        updatedAt: Timestamp.now(),
      });
      console.log(`[character-service] ステータス更新: failed`);
    } catch (updateErr) {
      console.error(`[character-service] Failed to update status to failed for ${characterId}:`, updateErr);
    }
  }
}
