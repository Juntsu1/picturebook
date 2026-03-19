import OpenAI from 'openai';
import type { Theme, StoryTemplate, CharacterProfile } from '@picture-book/shared';
import { THEME_LABELS } from '@picture-book/shared';
import { createOpenAIClient } from '../lib/openai.js';

export interface ChildProfile {
  name: string;
  age: number;
  gender?: string | null;
  favoriteColor?: string | null;
  favoriteAnimal?: string | null;
  appearance?: string | null;
}

export interface StoryResult {
  title: string;
  pages: { pageNumber: number; text: string; outfit?: string }[];
}

export class StoryEngineError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'StoryEngineError';
  }
}

const RETRY_DELAYS = [1000, 2000, 4000];

function getAgeGroup(age: number): { label: string; maxSentenceLength: number; vocabLevel: string; pageCount: number } {
  if (age <= 3) {
    return { label: '0-3歳', maxSentenceLength: 15, vocabLevel: 'ひらがなのみ、非常に簡単な単語', pageCount: 8 };
  }
  if (age <= 6) {
    return { label: '4-6歳', maxSentenceLength: 30, vocabLevel: 'ひらがな中心、簡単なカタカナ、基本的な語彙', pageCount: 10 };
  }
  if (age <= 9) {
    return { label: '7-9歳', maxSentenceLength: 50, vocabLevel: 'ひらがな・カタカナ、簡単な漢字、やや豊かな語彙', pageCount: 12 };
  }
  return { label: '10歳以上', maxSentenceLength: 80, vocabLevel: '漢字を含む、豊かな語彙と表現', pageCount: 16 };
}

function buildPrompt(profile: ChildProfile, theme: Theme, pageCount?: number): string {
  const ageGroup = getAgeGroup(profile.age);
  const actualPageCount = pageCount ?? ageGroup.pageCount;
  const themeLabel = THEME_LABELS[theme];

  const profileDetails = [
    `主人公の名前: ${profile.name}`,
    `年齢: ${profile.age}歳`,
    profile.gender ? `性別: ${profile.gender}` : null,
    profile.favoriteColor ? `好きな色: ${profile.favoriteColor}` : null,
    profile.favoriteAnimal ? `好きな動物: ${profile.favoriteAnimal}` : null,
    profile.appearance ? `外見の特徴: ${profile.appearance}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `あなたは子供向け絵本の作家です。以下の情報に基づいて、子供向けの絵本ストーリーを作成してください。

## 主人公の情報
${profileDetails}

## テーマ
${themeLabel}

## 対象年齢グループ
${ageGroup.label}

## 制約条件
- 主人公の名前「${profile.name}」を必ずストーリー中で使用してください
- 各ページの文章は${ageGroup.maxSentenceLength}文字以内にしてください
- 語彙レベル: ${ageGroup.vocabLevel}
- ページ数: ちょうど${actualPageCount}ページ
- 暴力的、性的、恐怖を与える内容は絶対に含めないでください
- ポジティブで教育的なメッセージを含めてください
- ストーリーには起承転結を持たせてください

## 出力形式
以下のJSON形式で出力してください。JSON以外のテキストは含めないでください。
各ページに「outfit」フィールドを含めてください。これはそのページでの主人公の服装をイラストレーター向けに詳細に記述するものです。
- 以下の項目をすべて含めてください: トップス（色・襟の形・袖の長さ）、ボトムス（色・丈）、靴（色・種類）、アクセサリー（あれば）
- 着替える必然性がないシーンでは、前のページとまったく同じ outfit 文字列をコピーしてください（1文字も変えない）
- パジャマ→外出着、水着→普段着など、ストーリー上自然な着替えのみ変更してください
- outfit は英語で記述してください（イラスト生成AIが英語で処理するため）

{
  "title": "絵本のタイトル",
  "pages": [
    { "pageNumber": 1, "text": "1ページ目のテキスト", "outfit": "red crew-neck short-sleeve T-shirt, blue denim shorts, white low-cut sneakers with velcro straps" },
    { "pageNumber": 2, "text": "2ページ目のテキスト", "outfit": "red crew-neck short-sleeve T-shirt, blue denim shorts, white low-cut sneakers with velcro straps" }
  ]
}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStoryResponse(content: string): StoryResult {
  // Extract JSON from the response (handle markdown code blocks)
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  if (!parsed.title || typeof parsed.title !== 'string') {
    throw new Error('レスポンスにタイトルが含まれていません');
  }
  if (!Array.isArray(parsed.pages) || parsed.pages.length === 0) {
    throw new Error('レスポンスにページが含まれていません');
  }

  const pages = parsed.pages.map((p: { pageNumber: number; text: string; outfit?: string }, i: number) => ({
    pageNumber: p.pageNumber ?? i + 1,
    text: String(p.text),
    ...(p.outfit ? { outfit: String(p.outfit) } : {}),
  }));

  // Validate page count is within 1-16
  if (pages.length < 1 || pages.length > 16) {
    throw new Error(`ページ数が範囲外です: ${pages.length}（1〜16ページ必要）`);
  }

  return { title: parsed.title, pages };
}

export async function generateStory(
  profile: ChildProfile,
  theme: Theme,
  openaiClient?: OpenAI,
  pageCount?: number
): Promise<StoryResult> {
  const client = openaiClient ?? createOpenAIClient();
  const prompt = buildPrompt(profile, theme, pageCount);

  let lastError: Error | null = null;

  console.log(`[story-engine] OPENAI_API_KEY set: ${!!process.env.OPENAI_API_KEY}, length: ${process.env.OPENAI_API_KEY?.length ?? 0}`);

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      console.log(`[story-engine] attempt ${attempt + 1}/${RETRY_DELAYS.length + 1}: OpenAI API 呼び出し中...`);
      const callStart = Date.now();

      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'あなたは子供向け絵本の専門作家です。安全で楽しいストーリーを作成します。必ず指定されたJSON形式で回答してください。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      console.log(`[story-engine] OpenAI API 応答受信: ${Date.now() - callStart}ms, finish_reason=${response.choices[0]?.finish_reason}`);

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI APIからの応答が空です');
      }

      console.log(`[story-engine] レスポンス内容 (先頭200文字): ${content.slice(0, 200)}`);
      return parseStoryResponse(content);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[story-engine] attempt ${attempt + 1} エラー:`, lastError.message);

      if (attempt < RETRY_DELAYS.length) {
        console.log(`[story-engine] ${RETRY_DELAYS[attempt]}ms 後にリトライ...`);
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  throw new StoryEngineError(
    `ストーリー生成に失敗しました: ${lastError?.message ?? '不明なエラー'}`,
    true
  );
}

function buildTemplatePrompt(
  template: StoryTemplate,
  characterAssignments: Map<string, CharacterProfile>,
  pageCount?: number
): string {
  // Determine youngest character's age for age-based constraints
  const ages = Array.from(characterAssignments.values())
    .map((c) => c.age)
    .filter((a): a is number => a !== null);
  const youngestAge = ages.length > 0 ? Math.min(...ages) : 5;
  const ageGroup = getAgeGroup(youngestAge);
  const actualPageCount = pageCount ?? template.pages.length;
  const themeLabel = THEME_LABELS[template.theme];

  // Build character details section
  const characterDetails = Array.from(characterAssignments.entries())
    .map(([role, char]) => {
      const parts = [
        `- [${role}] ${char.name}`,
        char.age !== null ? `年齢: ${char.age}歳` : null,
        `役割: ${role}`,
        char.appearance ? `外見の特徴: ${char.appearance}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return parts;
    })
    .join('\n');

  // Build page templates with placeholders replaced
  const pageTemplates = template.pages.slice(0, actualPageCount).map((page) => {
    let text = page.textTemplate;
    for (const [role, char] of characterAssignments.entries()) {
      text = text.replaceAll(`{${role}}`, char.name);
    }
    const rolesOnPage = page.roles.join(', ');
    return `ページ${page.pageNumber}: 「${text}」（登場キャラクター: ${rolesOnPage}）`;
  }).join('\n');

  // Build role labels list for outfit instructions
  const roleLabels = Array.from(characterAssignments.keys())
    .map((role) => `[${role}]`)
    .join(', ');

  return `あなたは子供向け絵本の作家です。以下のテンプレートとキャラクター情報に基づいて、子供向けの絵本ストーリーを作成してください。

## キャラクター情報
${characterDetails}

## テーマ
${themeLabel}

## 対象年齢グループ
${ageGroup.label}

## ストーリーテンプレート
${pageTemplates}

## 制約条件
- 各キャラクターの名前を必ずストーリー中で使用してください
- 各ページの文章は${ageGroup.maxSentenceLength}文字以内にしてください
- 語彙レベル: ${ageGroup.vocabLevel}
- ページ数: ちょうど${actualPageCount}ページ
- 暴力的、性的、恐怖を与える内容は絶対に含めないでください
- ポジティブで教育的なメッセージを含めてください
- ストーリーには起承転結を持たせてください

## 出力形式
以下のJSON形式で出力してください。JSON以外のテキストは含めないでください。
各ページに「outfit」フィールドを含めてください。これはそのページでの各キャラクターの服装をイラストレーター向けに詳細に記述するものです。
- 複数キャラクターが登場するページでは、各キャラクターの服装をロールラベル付きで記述してください（例: ${roleLabels}）
- 以下の項目をすべて含めてください: トップス（色・襟の形・袖の長さ）、ボトムス（色・丈）、靴（色・種類）、アクセサリー（あれば）
- 着替える必然性がないシーンでは、前のページとまったく同じ outfit 文字列をコピーしてください（1文字も変えない）
- パジャマ→外出着、水着→普段着など、ストーリー上自然な着替えのみ変更してください
- outfit は英語で記述してください（イラスト生成AIが英語で処理するため）

{
  "title": "絵本のタイトル",
  "pages": [
    { "pageNumber": 1, "text": "1ページ目のテキスト", "outfit": "[protagonist] red crew-neck T-shirt, blue shorts, white sneakers\\n[papa] blue polo shirt, khaki chinos, brown loafers" },
    { "pageNumber": 2, "text": "2ページ目のテキスト", "outfit": "[protagonist] red crew-neck T-shirt, blue shorts, white sneakers\\n[papa] blue polo shirt, khaki chinos, brown loafers" }
  ]
}`;
}

export async function generateStoryFromTemplate(
  template: StoryTemplate,
  characterAssignments: Map<string, CharacterProfile>,
  openaiClient?: OpenAI,
  pageCount?: number
): Promise<StoryResult> {
  const client = openaiClient ?? createOpenAIClient();
  const prompt = buildTemplatePrompt(template, characterAssignments, pageCount);

  let lastError: Error | null = null;

  console.log(`[story-engine] generateStoryFromTemplate: OPENAI_API_KEY set: ${!!process.env.OPENAI_API_KEY}, length: ${process.env.OPENAI_API_KEY?.length ?? 0}`);

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      console.log(`[story-engine] generateStoryFromTemplate attempt ${attempt + 1}/${RETRY_DELAYS.length + 1}: OpenAI API 呼び出し中...`);
      const callStart = Date.now();

      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'あなたは子供向け絵本の専門作家です。安全で楽しいストーリーを作成します。必ず指定されたJSON形式で回答してください。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      console.log(`[story-engine] generateStoryFromTemplate OpenAI API 応答受信: ${Date.now() - callStart}ms, finish_reason=${response.choices[0]?.finish_reason}`);

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI APIからの応答が空です');
      }

      console.log(`[story-engine] generateStoryFromTemplate レスポンス内容 (先頭200文字): ${content.slice(0, 200)}`);
      return parseStoryResponse(content);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[story-engine] generateStoryFromTemplate attempt ${attempt + 1} エラー:`, lastError.message);

      if (attempt < RETRY_DELAYS.length) {
        console.log(`[story-engine] ${RETRY_DELAYS[attempt]}ms 後にリトライ...`);
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  throw new StoryEngineError(
    `テンプレートベースのストーリー生成に失敗しました: ${lastError?.message ?? '不明なエラー'}`,
    true
  );
}

// Exported for testing
export { buildPrompt, buildTemplatePrompt, parseStoryResponse, getAgeGroup };
