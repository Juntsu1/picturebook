import OpenAI from 'openai';
import { getStorage } from 'firebase-admin/storage';
import type { Theme, CharacterProfile } from '@picture-book/shared';
import { THEME_LABELS } from '@picture-book/shared';
import type { ChildProfile } from './story-engine.js';
import { createOpenAIClient } from '../lib/openai.js';
import { downloadPhoto } from './photo-upload-service.js';

export interface IllustrationResult {
  pageNumber: number;
  imageUrl: string; // Firebase Storage URL
}

export class IllustrationEngineError extends Error {
  constructor(
    message: string,
    public readonly pageNumber: number,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'IllustrationEngineError';
  }
}

const RETRY_DELAYS = [1000, 2000, 4000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildIllustrationPrompt(
  page: { pageNumber: number; text: string; outfit?: string },
  profile: ChildProfile,
  theme: Theme
): string {
  const themeLabel = THEME_LABELS[theme];

  const details = [
    profile.favoriteColor ? `好きな色: ${profile.favoriteColor}` : null,
    profile.favoriteAnimal ? `好きな動物: ${profile.favoriteAnimal}` : null,
  ]
    .filter(Boolean)
    .join('、');

  const characterNote = details
    ? `主人公「${profile.name}」の設定: ${details}`
    : `主人公の名前は「${profile.name}」`;

  const outfitLine = page.outfit
    ? `\nCharacter outfit (EXACT — same collar, sleeves, shoes on every page): ${page.outfit}\n`
    : '';

  return `A warm, colorful watercolor-style illustration for a picture book.

Theme: ${themeLabel}
Scene description: 「${page.text}」

Character: ${characterNote}
${outfitLine}
Style requirements:
- Soft watercolor painting style, suitable for a picture book
- Bright, cheerful, and vibrant colors
- Cartoon-like friendly characters (no realistic human depictions)
- Focus on animals, nature, and fantasy elements
- No text or words in the image`;
}


/**
 * GPT-4o のビジョンで写真を分析し、子供の外見を詳細にテキスト記述する。
 * この記述をイラスト生成プロンプトに埋め込むことで、似顔絵の精度を上げる。
 * 英語で記述することでイラスト生成モデルの精度を向上させる。
 */
async function describeChildAppearance(
  client: OpenAI,
  photoBuffer: Buffer
): Promise<string> {
  const b64 = photoBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'あなたは子供向け絵本のキャラクターデザイナーです。保護者がお子様の絵本用キャラクターの参考として写真を提供しました。この写真を元に、絵本イラストレーターがキャラクターを一貫して描けるようにデザインメモを作成してください。',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `子供の絵本を制作中です。この参考画像を元に、絵本のキャラクターデザインメモを作成してください。

以下の項目を英語の箇条書きで記述してください:
- Hair style (length, bangs, parting, texture)
- Hair color
- Skin tone
- Face shape
- Eye features
- Clothing style visible in the image

これはキャラクターデザインの参考メモです。箇条書きのみで回答してください。`,
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
        ],
      },
    ],
    max_tokens: 400,
  });

  const result = response.choices[0]?.message?.content?.trim() ?? '';

  // GPT-4oが拒否した場合は空文字を返す（キャラクターシートだけで対応）
  if (result.toLowerCase().includes("i'm sorry") || result.toLowerCase().includes("i can't")) {
    console.warn('[describeChildAppearance] GPT-4oが記述を拒否、スキップ');
    return '';
  }

  return result;
}

/**
 * 写真からキャラクターシートを生成する。
 * 複数ポーズ・表情を含む1枚のシートを作り、以降のページ生成で参照画像として使う。
 * 写真を2枚アンカーとして渡し、透明マスクで全面再描画を許可する。
 */
async function generateCharacterSheet(
  client: OpenAI,
  photoBuffer: Buffer,
  profile: ChildProfile,
  appearanceDescription?: string
): Promise<Buffer> {
  const appearanceBlock = appearanceDescription
    ? `\nCHILD'S APPEARANCE:\n${appearanceDescription}\n`
    : '';

  const sheetPrompt = `CHARACTER SHEET GENERATION (VERY IMPORTANT)

IDENTITY & STYLE (HIGHEST PRIORITY):
- The FIRST reference image is the ANCHOR. Match the SAME person EXACTLY.
- Keep the SAME face (eyes/nose/mouth proportions, face shape), hairstyle, and clothing.
- Keep the SAME illustration style as the anchor image (do NOT change the style).
- Do NOT introduce features from any other images.
${appearanceBlock}
CHARACTER INFO:
- Name: ${profile.name}
- Age: ${profile.age}

OUTPUT:
- Create ONE character sheet image with multiple cuts of the SAME character.
- Include multiple poses and expressions (e.g., full body neutral, smiling, surprised, thinking, walking).
- Use a warm, colorful picture book illustration style.
- Plain simple background (paper-like). No strong shadows.

STRICT PROHIBITIONS:
- ONLY ONE PERSON (no extra people, no animals)
- NO text, NO speech bubbles, NO labels
- NO watermark, NO borders, NO panel frames`.trim();

  const imageFile1 = new File([new Uint8Array(photoBuffer)], 'photo1.png', { type: 'image/png' });
  const imageFile2 = new File([new Uint8Array(photoBuffer)], 'photo2.png', { type: 'image/png' });

  const response = await client.images.edit({
    model: 'gpt-image-1.5',
    image: [imageFile1, imageFile2],
    prompt: sheetPrompt,
    n: 1,
    size: '1024x1024',
    quality: 'high',
  });

  const imageData = response.data?.[0];
  const b64 = imageData?.b64_json;
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('キャラクターシート生成APIからの応答が空です');
  }

  return Buffer.from(b64, 'base64');
}

function buildPhotoReferencePrompt(
  page: { pageNumber: number; text: string; outfit?: string },
  profile: ChildProfile,
  theme: Theme,
  appearanceDescription?: string
): string {
  const themeLabel = THEME_LABELS[theme];

  const appearanceBlock = appearanceDescription
    ? `\nEXACT APPEARANCE TO REPRODUCE:\n${appearanceDescription}\n`
    : '';

  const outfitBlock = page.outfit
    ? `\nOUTFIT (MUST match exactly across pages — do NOT change any detail):\n${page.outfit}\nDraw EXACTLY this outfit: same collar shape, same sleeve length, same shoe type and color. No variations.\n`
    : '';

  return `Create a picture book illustration for one page of a story.

HIGHEST PRIORITY — CHARACTER CONSISTENCY:
- The FIRST reference image is the CHARACTER SHEET — it shows the main character in multiple poses.
- The SECOND reference image is the original PHOTO of the child.
- The character in this illustration MUST match the character sheet EXACTLY.
- Keep the EXACT same face, hairstyle, hair color, and body proportions as shown in the character sheet.
- The character must be immediately recognizable as the same person across all pages.
${appearanceBlock}${outfitBlock}
SCENE:
Theme: ${themeLabel}
Story text: "${page.text}"
Character name: ${profile.name}

STYLE:
- Match the SAME illustration style as the character sheet
- Warm, colorful watercolor picture book illustration
- Bright cheerful colors for the background and environment
- No text or words in the image`;
}

/**
 * 1024x1024 の全面透明 PNG を生成する。
 * images.edit の mask に渡すことで、全面再描画を許可しつつ
 * 参照画像の特徴（顔・髪型など）を保持させる。
 */
function createTransparentMaskPng(): Buffer {
  // Minimal valid 1x1 transparent PNG (will be scaled by the API)
  // PNG signature + IHDR + IDAT (single transparent pixel) + IEND
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
    return Buffer.concat([len, typeB, data, crcB]);
  }

  // IHDR: 1x1, 8-bit RGBA
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);  // width
  ihdrData.writeUInt32BE(1, 4);  // height
  ihdrData[8] = 8;               // bit depth
  ihdrData[9] = 6;               // color type: RGBA
  ihdrData[10] = 0;              // compression
  ihdrData[11] = 0;              // filter
  ihdrData[12] = 0;              // interlace

  // IDAT: zlib-compressed single row: filter=0, R=0, G=0, B=0, A=0
  // Raw deflate of [0x00, 0x00, 0x00, 0x00, 0x00] with zlib header
  const idatData = Buffer.from([
    0x78, 0x01, 0x62, 0x60, 0x60, 0x60, 0x60, 0x60,
    0x00, 0x00, 0x00, 0x05, 0x00, 0x01,
  ]);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function generateWithPhoto(
  client: OpenAI,
  prompt: string,
  photoBuffer: Buffer,
  characterSheetBuffer?: Buffer
): Promise<string> {
  let images: File[];
  if (characterSheetBuffer) {
    // ★ キャラクターシート（アンカー）+ 元写真で一貫性を強化
    const sheetFile = new File([new Uint8Array(characterSheetBuffer)], 'sheet.png', { type: 'image/png' });
    const photoFile = new File([new Uint8Array(photoBuffer)], 'photo.png', { type: 'image/png' });
    images = [sheetFile, photoFile];
  } else {
    // フォールバック: 写真を2枚渡す従来方式
    const imageFile1 = new File([new Uint8Array(photoBuffer)], 'photo1.png', { type: 'image/png' });
    const imageFile2 = new File([new Uint8Array(photoBuffer)], 'photo2.png', { type: 'image/png' });
    images = [imageFile1, imageFile2];
  }

  const response = await client.images.edit({
    model: 'gpt-image-1.5',
    image: images,
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'high',
  });

  const imageData = response.data?.[0];
  const b64 = imageData?.b64_json;
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('画像編集APIからの応答が空です');
  }

  return b64;
}

async function uploadToStorage(
  imageData: Buffer,
  storagePath: string,
  bucket?: { file: (path: string) => { save: (data: Buffer, opts: object) => Promise<void>; getSignedUrl: (opts: object) => Promise<string[]>; publicUrl: () => string } }
): Promise<string> {
  const storageBucket = bucket ?? getStorage().bucket();
  const file = storageBucket.file(storagePath);

  await file.save(imageData, {
    metadata: {
      contentType: 'image/png',
    },
  });

  // Use signed URL (valid for 7 days) for private buckets
  try {
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });
    return signedUrl;
  } catch {
    // Fallback to public URL if signing fails
    return file.publicUrl();
  }
}

export async function generateForPage(
  page: { pageNumber: number; text: string; outfit?: string },
  profile: ChildProfile,
  theme: Theme,
  options: {
    userId: string;
    bookId: string;
    photoStoragePath?: string | null;
    appearanceDescription?: string;
    characterSheetBuffer?: Buffer;
    openaiClient?: OpenAI;
    storageBucket?: { file: (path: string) => { save: (data: Buffer, opts: object) => Promise<void>; getSignedUrl: (opts: object) => Promise<string[]>; publicUrl: () => string } };
  }
): Promise<IllustrationResult> {
  const client = options.openaiClient ?? createOpenAIClient();
  const illustrationStoragePath = `users/${options.userId}/books/${options.bookId}/illustrations/page-${page.pageNumber}.png`;

  // Photo reference path: use images.edits with character sheet + photo
  if (options.photoStoragePath) {
    const photoBuffer = await downloadPhoto(options.photoStoragePath, {
      storageBucket: options.storageBucket as never,
    });
    const photoPrompt = buildPhotoReferencePrompt(page, profile, theme, options.appearanceDescription);

    let lastPhotoError: Error | null = null;

    // Retry with images.edits
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const b64 = await generateWithPhoto(client, photoPrompt, photoBuffer, options.characterSheetBuffer);
        const imageBuffer = Buffer.from(b64, 'base64');

        const imageUrl = await uploadToStorage(
          imageBuffer,
          illustrationStoragePath,
          options.storageBucket
        );

        return { pageNumber: page.pageNumber, imageUrl };
      } catch (error) {
        lastPhotoError = error instanceof Error ? error : new Error(String(error));

        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    // Fallback to text-only images.generate
    console.warn(
      `[illustration-engine] images.edits failed for page ${page.pageNumber}, falling back to images.generate: ${lastPhotoError?.message}`
    );
  }

  // Text-only generation (no photo or fallback)
  const prompt = buildIllustrationPrompt(page, profile, theme);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await client.images.generate({
        model: 'gpt-image-1.5',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'png',
      });

      const imageData = response.data?.[0];
      const b64 = imageData?.b64_json;
      if (!b64 || typeof b64 !== 'string') {
        throw new Error('画像生成APIからの応答が空です');
      }

      const imageBuffer = Buffer.from(b64, 'base64');

      const imageUrl = await uploadToStorage(
        imageBuffer,
        illustrationStoragePath,
        options.storageBucket
      );

      return {
        pageNumber: page.pageNumber,
        imageUrl,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  throw new IllustrationEngineError(
    `ページ${page.pageNumber}のイラスト生成に失敗しました: ${lastError?.message ?? '不明なエラー'}`,
    page.pageNumber,
    true
  );
}

type StorageBucket = { file: (path: string) => { save: (data: Buffer, opts: object) => Promise<void>; getSignedUrl: (opts: object) => Promise<string[]>; publicUrl: () => string } };

function buildMultiCharacterPrompt(
  page: { pageNumber: number; text: string; outfit?: string },
  characters: Map<string, { profile: CharacterProfile; photoBuffer?: Buffer; characterSheetBuffer?: Buffer }>,
  pageRoles: string[],
  theme: Theme,
  imagePairIndex: Map<string, number>
): string {
  const themeLabel = THEME_LABELS[theme];

  // Build image pair descriptions
  const pairLines: string[] = [];
  for (const [role, idx] of imagePairIndex.entries()) {
    const charData = characters.get(role);
    if (!charData) continue;
    const imgStart = idx * 2 + 1;
    pairLines.push(`- ${idx === 0 ? 'FIRST' : idx === 1 ? 'SECOND' : `PAIR ${idx + 1}`} pair (images ${imgStart}-${imgStart + 1}) = ${charData.profile.name} (${role})`);
  }

  // Build character details
  const charDetailLines: string[] = [];
  for (const role of pageRoles) {
    const charData = characters.get(role);
    if (!charData) continue;
    const p = charData.profile;
    const agePart = p.age != null ? `age ${p.age}` : '';
    const appearancePart = p.appearance || p.appearanceDescription || '';
    const detailParts = [agePart, appearancePart].filter(Boolean).join(', ');
    let line = `[${role}] ${p.name}${detailParts ? `, ${detailParts}` : ''}`;

    // Extract outfit for this role from the page outfit
    if (page.outfit) {
      const outfitForRole = extractOutfitForRole(page.outfit, role);
      if (outfitForRole) {
        line += `\n  Outfit: ${outfitForRole}`;
      }
    }

    charDetailLines.push(line);
  }

  const pairSection = pairLines.length > 0
    ? `- Reference images are provided in pairs: [character_sheet, original_photo]\n${pairLines.join('\n')}\n- Each character MUST match their respective character sheet EXACTLY`
    : '- No reference images provided, generate characters based on text descriptions only';

  return `HIGHEST PRIORITY — CHARACTER CONSISTENCY:
${pairSection}

CHARACTER DETAILS:
${charDetailLines.join('\n')}

SCENE:
Theme: ${themeLabel}
Story text: "${page.text}"

STYLE:
- Warm, colorful watercolor picture book illustration
- All characters must be clearly distinguishable
- No text or words in the image`;
}

function extractOutfitForRole(outfit: string, role: string): string {
  // Try to extract the outfit section for a specific role from the combined outfit string
  // Format: "[protagonist] red T-shirt... [papa] blue polo..."
  const regex = new RegExp(`\\[${role}\\]\\s*(.+?)(?=\\[\\w+\\]|$)`, 's');
  const match = outfit.match(regex);
  if (match) return match[1].trim();
  // If no role labels, return the whole outfit (single character case)
  return outfit;
}

export async function generateForPageMultiCharacter(
  page: { pageNumber: number; text: string; outfit?: string },
  characters: Map<string, { profile: CharacterProfile; photoBuffer?: Buffer; characterSheetBuffer?: Buffer }>,
  pageRoles: string[],
  theme: Theme,
  options: { userId: string; bookId: string; openaiClient?: OpenAI; storageBucket?: StorageBucket }
): Promise<IllustrationResult> {
  const client = options.openaiClient ?? createOpenAIClient();
  const illustrationStoragePath = `users/${options.userId}/books/${options.bookId}/illustrations/page-${page.pageNumber}.png`;

  // Build reference image array: [sheet1, photo1, sheet2, photo2, ...]
  const imageFiles: File[] = [];
  const imagePairIndex = new Map<string, number>();
  let pairCount = 0;

  for (const role of pageRoles) {
    const charData = characters.get(role);
    if (!charData) continue;

    if (charData.characterSheetBuffer && charData.photoBuffer) {
      // Has both sheet and photo — ideal case
      const sheetFile = new File([new Uint8Array(charData.characterSheetBuffer)], `sheet_${role}.png`, { type: 'image/png' });
      const photoFile = new File([new Uint8Array(charData.photoBuffer)], `photo_${role}.png`, { type: 'image/png' });
      imageFiles.push(sheetFile, photoFile);
      imagePairIndex.set(role, pairCount);
      pairCount++;
    } else if (charData.photoBuffer) {
      // No sheet, fallback: photo twice
      const photoFile1 = new File([new Uint8Array(charData.photoBuffer)], `photo1_${role}.png`, { type: 'image/png' });
      const photoFile2 = new File([new Uint8Array(charData.photoBuffer)], `photo2_${role}.png`, { type: 'image/png' });
      imageFiles.push(photoFile1, photoFile2);
      imagePairIndex.set(role, pairCount);
      pairCount++;
    }
    // If neither photo nor sheet, skip (text-only for that character)
  }

  const prompt = buildMultiCharacterPrompt(page, characters, pageRoles, theme, imagePairIndex);

  // If we have reference images, use images.edit
  if (imageFiles.length > 0) {
    let lastEditError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const response = await client.images.edit({
          model: 'gpt-image-1.5',
          image: imageFiles,
          prompt,
          n: 1,
          size: '1024x1024',
          quality: 'high',
        });

        const imageData = response.data?.[0];
        const b64 = imageData?.b64_json;
        if (!b64 || typeof b64 !== 'string') {
          throw new Error('画像編集APIからの応答が空です');
        }

        const imageBuffer = Buffer.from(b64, 'base64');
        const imageUrl = await uploadToStorage(imageBuffer, illustrationStoragePath, options.storageBucket);
        return { pageNumber: page.pageNumber, imageUrl };
      } catch (error) {
        lastEditError = error instanceof Error ? error : new Error(String(error));
        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    // Fallback to text-only images.generate
    console.warn(
      `[illustration-engine] images.edit failed for multi-character page ${page.pageNumber}, falling back to images.generate: ${lastEditError?.message}`
    );
  }

  // Text-only generation (no photos or fallback after edit failures)
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await client.images.generate({
        model: 'gpt-image-1.5',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        output_format: 'png',
      });

      const imageData = response.data?.[0];
      const b64 = imageData?.b64_json;
      if (!b64 || typeof b64 !== 'string') {
        throw new Error('画像生成APIからの応答が空です');
      }

      const imageBuffer = Buffer.from(b64, 'base64');
      const imageUrl = await uploadToStorage(imageBuffer, illustrationStoragePath, options.storageBucket);
      return { pageNumber: page.pageNumber, imageUrl };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  throw new IllustrationEngineError(
    `ページ${page.pageNumber}のマルチキャラクターイラスト生成に失敗しました: ${lastError?.message ?? '不明なエラー'}`,
    page.pageNumber,
    true
  );
}

// Exported for testing
export { buildIllustrationPrompt, buildPhotoReferencePrompt, generateWithPhoto, uploadToStorage, describeChildAppearance, createTransparentMaskPng, generateCharacterSheet, buildMultiCharacterPrompt, extractOutfitForRole };
