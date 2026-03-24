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
  pages: { pageNumber: number; text: string; outfit?: string; illustration_notes?: string }[];
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

function getAgeGroup(age: number): {
  label: string;
  ageKey: '0-2' | '3-4' | '5-6' | '6-8';
  maxSentenceLength: number;
  vocabLevel: string;
  pageCount: number;
} {
  if (age <= 2) {
    return { label: '0-2歳', ageKey: '0-2', maxSentenceLength: 15, vocabLevel: 'ひらがなのみ、非常に簡単な単語', pageCount: 8 };
  }
  if (age <= 4) {
    return { label: '3-4歳', ageKey: '3-4', maxSentenceLength: 25, vocabLevel: 'ひらがな中心、簡単なカタカナ、基本的な語彙', pageCount: 10 };
  }
  if (age <= 6) {
    return { label: '5-6歳', ageKey: '5-6', maxSentenceLength: 40, vocabLevel: 'ひらがな・カタカナ、簡単な漢字、やや豊かな語彙', pageCount: 12 };
  }
  return { label: '6-8歳', ageKey: '6-8', maxSentenceLength: 60, vocabLevel: '漢字を含む、豊かな語彙と表現', pageCount: 14 };
}

const AGE_PROFILES: Record<string, {
  focus: string[];
  repetition: string;
  onomatopoeia: string;
  lineBreakDensity: string;
  pageDensity: string;
}> = {
  '0-2': {
    focus: ['音', '反復', '安心', '発見'],
    repetition: '高め（同じフレーズを繰り返す）',
    onomatopoeia: '多用してよい',
    lineBreakDensity: '高め（1〜2文で改行）',
    pageDensity: '非常に少ない（1見開き1〜2文）',
  },
  '3-4': {
    focus: ['わかりやすい出来事', '反復', '予測できる型', '感情の変化'],
    repetition: '高め',
    onomatopoeia: '適度に使う',
    lineBreakDensity: '中〜高め',
    pageDensity: '少ない（1見開き2〜3文）',
  },
  '5-6': {
    focus: ['物語の起伏', '少し複雑な感情', '挑戦', '解決'],
    repetition: '中程度',
    onomatopoeia: '適度に使う',
    lineBreakDensity: '中程度',
    pageDensity: '少〜中程度（1見開き3〜4文）',
  },
  '6-8': {
    focus: ['物語性', '感情の陰影', '自力読みに耐える流れ', '絵との余白維持'],
    repetition: '低〜中程度',
    onomatopoeia: '控えめ',
    lineBreakDensity: '低〜中程度',
    pageDensity: '中程度（1見開き3〜5文）',
  },
};

function buildStoryRulesBlock(ageKey: string, maxSentenceLength: number, vocabLevel: string): string {
  const p = AGE_PROFILES[ageKey] ?? AGE_PROFILES['5-6'];
  return [
    '## 絵本ストーリー生成ルール（必ず守ること）',
    '',
    '### 物語構造',
    '- 物語の芯は1つ（主人公・願い・障害・変化を明確に）',
    '- 感情の流れは1本に絞る（例: こわい→だいじょうぶ）',
    '- 一見開き一場面・一拍を原則にする',
    '- 出来事の因果関係を見える形でつなぐ',
    '- 最初の数見開きで主人公・願い・問題のいずれかを出す',
    '- 各見開きの終わりに次をめくりたくなる引力を置く（最終見開きを除く）',
    '- 終わりは解決後に少し余韻を残す（説教で終わらせない）',
    '- 子どもの体感に近い視点を保つ',
    '',
    '### 言語・文体',
    '- 声に出して自然な文にする',
    `- 1文は${maxSentenceLength}文字以内、1文1つの意味`,
    `- 語彙レベル: ${vocabLevel}`,
    '- **ひらがな・カタカナを中心に書く。漢字は使わない。**',
    '- 例: 「幼稚園」→「ようちえん」、「友達」→「ともだち」、「一緒」→「いっしょ」',
    '- 抽象語より具体語を優先する',
    '- 動詞中心で動きを出す',
    '- 難語・説明言葉・大人の語彙を控える',
    `- 繰り返しは意図的に使う（${p.repetition}）`,
    `- オノマトペ: ${p.onomatopoeia}`,
    '- セリフは短く、話者が混乱しないようにする',
    '- 文体・表記を一冊の中で統一する',
    '',
    '### 改行ルール',
    '- 改行は息・意味・絵のまとまりに沿って入れる',
    '- 句として一緒に読まれるものを分断しない',
    '- 短い一行は驚き・発見・余韻など効かせたい場所に限定する',
    '- スペースやタブで見た目を無理に揃えない',
    '- 改行で読む速度を調整する',
    '',
    '### 文章と絵の関係',
    '- 文章で全部説明しない（絵に任せる部分を残す）',
    '- 各見開きに描ける場面がある',
    '- 絵の指示は本文に混ぜず illustration_notes フィールドに分ける',
    `- テキスト密度を絵本として適切に保つ（${p.pageDensity}）`,
    '',
    '### 倫理・安全',
    '- 子どもを見下さない',
    '- 説教で終わらせない',
    '- 怖さや悲しさを扱う場合は感情の出口を作る',
    '- 固定観念に依存しすぎない',
    '',
    `### 対象年齢フォーカス（${ageKey}歳）`,
    `重点: ${p.focus.join('、')}`,
    `改行密度: ${p.lineBreakDensity}`,
  ].join('\n');
}

function buildPrompt(profile: ChildProfile, theme: Theme, pageCount?: number): string {
  const ageGroup = getAgeGroup(profile.age);
  const actualPageCount = pageCount ?? ageGroup.pageCount;
  const themeLabel = THEME_LABELS[theme];
  const rulesBlock = buildStoryRulesBlock(ageGroup.ageKey, ageGroup.maxSentenceLength, ageGroup.vocabLevel);

  const profileDetails = [
    `主人公の名前: ${profile.name}`,
    `年齢: ${profile.age}歳`,
    profile.gender ? `性別: ${profile.gender}` : null,
    profile.favoriteColor ? `好きな色: ${profile.favoriteColor}` : null,
    profile.favoriteAnimal ? `好きな動物: ${profile.favoriteAnimal}` : null,
    profile.appearance ? `外見の特徴: ${profile.appearance}` : null,
  ].filter(Boolean).join('\n');

  return `あなたは子供向け絵本の専門作家です。以下のルールと情報に基づいて、絵本ストーリーを作成してください。

${rulesBlock}

## 主人公の情報
${profileDetails}

## テーマ
${themeLabel}

## ページ数
ちょうど${actualPageCount}見開き（ページ）

## 安全基準
- 暴力的・性的・恐怖を与える内容は絶対に含めない

## 出力形式
以下のJSON形式のみで出力してください。JSON以外のテキストは含めないでください。
- text_lines: 本文を改行単位の配列で記述する（改行ごとに要素を分ける）
- illustration_notes: 絵師向けの指示（本文には含めない）
- page_turn_hook: 次をめくらせる要素（最終ページは空でよい）
- outfit: そのページでの主人公の服装（英語で記述、着替えがない場合は前ページと同じ文字列をコピー）

{
  "title": "絵本のタイトル",
  "pages": [
    {
      "pageNumber": 1,
      "text_lines": ["1行目のテキスト", "2行目のテキスト"],
      "illustration_notes": "絵師向けメモ（省略可）",
      "page_turn_hook": "次をめくらせる要素",
      "outfit": "red crew-neck short-sleeve T-shirt, blue denim shorts, white low-cut sneakers"
    }
  ]
}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStoryResponse(content: string): StoryResult {
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

  const pages = parsed.pages.map((p: {
    pageNumber: number;
    text?: string;
    text_lines?: string[];
    outfit?: string;
    illustration_notes?: string;
  }, i: number) => {
    // text_lines 配列があれば改行で結合、なければ text をそのまま使う
    const text = Array.isArray(p.text_lines)
      ? p.text_lines.join('\n')
      : String(p.text ?? '');
    return {
      pageNumber: p.pageNumber ?? i + 1,
      text,
      ...(p.outfit ? { outfit: String(p.outfit) } : {}),
      ...(p.illustration_notes ? { illustration_notes: String(p.illustration_notes) } : {}),
    };
  });

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
        temperature: 0.8,
        response_format: { type: 'json_object' },
      });

      console.log(`[story-engine] OpenAI API 応答受信: ${Date.now() - callStart}ms, finish_reason=${response.choices[0]?.finish_reason}`);

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('OpenAI APIからの応答が空です');

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
  const ages = Array.from(characterAssignments.values())
    .map((c) => c.age)
    .filter((a): a is number => a !== null);
  const youngestAge = ages.length > 0 ? Math.min(...ages) : 5;
  const ageGroup = getAgeGroup(youngestAge);
  const actualPageCount = pageCount ?? template.pages.length;
  const themeLabel = THEME_LABELS[template.theme];
  const rulesBlock = buildStoryRulesBlock(ageGroup.ageKey, ageGroup.maxSentenceLength, ageGroup.vocabLevel);

  const characterDetails = Array.from(characterAssignments.entries())
    .map(([role, char]) => {
      return [
        `- [${role}] ${char.name}`,
        char.age !== null ? `年齢: ${char.age}歳` : null,
        `役割: ${role}`,
        char.appearance ? `外見の特徴: ${char.appearance}` : null,
      ].filter(Boolean).join(', ');
    })
    .join('\n');

  const pageTemplates = template.pages.slice(0, actualPageCount).map((page) => {
    let text = page.textTemplate;
    for (const [role, char] of characterAssignments.entries()) {
      text = text.replaceAll(`{${role}}`, char.name);
    }
    return `ページ${page.pageNumber}: 「${text}」（登場キャラクター: ${page.roles.join(', ')}）`;
  }).join('\n');

  const roleLabels = Array.from(characterAssignments.keys()).map((r) => `[${r}]`).join(', ');

  return `あなたは子供向け絵本の専門作家です。以下のルールとテンプレートに基づいて、絵本ストーリーを作成してください。

${rulesBlock}

## キャラクター情報
${characterDetails}

## テーマ
${themeLabel}

## ストーリーテンプレート（各ページの方向性）
${pageTemplates}

## ページ数
ちょうど${actualPageCount}見開き（ページ）

## 安全基準
- 暴力的・性的・恐怖を与える内容は絶対に含めない

## 出力形式
以下のJSON形式のみで出力してください。JSON以外のテキストは含めないでください。
- text_lines: 本文を改行単位の配列で記述する
- illustration_notes: 絵師向けの指示（本文には含めない）
- page_turn_hook: 次をめくらせる要素（最終ページは空でよい）
- outfit: 登場キャラクターの服装（英語、複数キャラクターはロールラベル付き: ${roleLabels}）

{
  "title": "絵本のタイトル",
  "pages": [
    {
      "pageNumber": 1,
      "text_lines": ["1行目のテキスト", "2行目のテキスト"],
      "illustration_notes": "絵師向けメモ（省略可）",
      "page_turn_hook": "次をめくらせる要素",
      "outfit": "[protagonist] red crew-neck T-shirt, blue shorts, white sneakers"
    }
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
        temperature: 0.8,
        response_format: { type: 'json_object' },
      });

      console.log(`[story-engine] generateStoryFromTemplate OpenAI API 応答受信: ${Date.now() - callStart}ms, finish_reason=${response.choices[0]?.finish_reason}`);

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('OpenAI APIからの応答が空です');

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
