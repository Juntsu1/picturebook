import { Timestamp } from 'firebase-admin/firestore';
import { getDb } from '../lib/firebase.js';
import { createOpenAIClient } from '../lib/openai.js';
import { checkText } from './content-filter.js';
import { createTemplate } from './template-service.js';
import type { Response } from 'express';
import type {
  CharacterSummary,
  ChatMessage,
  StoryDraft,
  ChatSSEEvent,
} from '@picture-book/shared';
import { MAX_CHAT_MESSAGES } from '@picture-book/shared';

function getSessionsCollection(userId: string) {
  return getDb().collection('users').doc(userId).collection('chatSessions');
}

function buildSystemPrompt(characters: CharacterSummary[]): string {
  const characterLines = characters.length > 0
    ? characters.map((c) => `- ${c.name}（${c.role}、${c.age ?? '不明'}歳）`).join('\n')
    : '（キャラクター未登録）';

  return `あなたは子供向け絵本の専門作家アシスタントです。
インタビュー形式でユーザーからストーリーの要件を引き出し、準備ができたら全ページのストーリーを一度に作成してください。

## 登録済みキャラクター
${characterLines}

## インタビューの進め方（必ず守ること）

### フェーズ1: 要件ヒアリング
以下の情報を会話の中で自然に確認してください。一度に全部聞かず、1〜2項目ずつ質問すること。

1. **どんなお話にしたいか**（テーマ・雰囲気）
2. **登場人物の確認**（登録済みキャラクターを提示し、追加・変更がないか確認）
3. **対象年齢**（登録済みキャラクターの年齢から推定してよい）
4. **特別なリクエスト**（好きなもの・場所・出来事など）

### フェーズ2: ストーリー生成
要件が揃ったら「では、ストーリーを作りますね！」と宣言してから、全ページを一度に生成する。
各ページを「【ページ1】」のように番号付きで表示する。

### フェーズ3: 修正対応
ユーザーが修正を求めたら該当ページを書き直す。
満足したら「ストーリーを完成させる」ボタンを押すよう案内する。

## 選択肢の提示方法（重要）
ユーザーが選びやすいよう、質問の後に選択肢を提示できます。
選択肢を提示する場合は、メッセージの末尾に以下の形式で追加してください：

[CHOICES: 選択肢1|選択肢2|選択肢3]

例：
どんなテーマにしますか？
[CHOICES: 冒険・探検|動物と友だち|家族のお出かけ|宇宙・星|海・水族館]

- 選択肢は3〜5個程度にする
- 「その他（自由に入力）」は不要（テキスト入力は常に使える）
- フェーズ1のヒアリング中は積極的に選択肢を使う
- ストーリー生成後の修正確認でも使ってよい

## ストーリー生成ルール（フェーズ2で使用）

### 物語構造
- 物語の芯は1つ（主人公・願い・障害・変化を明確に）
- 感情の流れは1本に絞る（例: こわい→だいじょうぶ）
- 一見開き一場面・一拍を原則にする
- 出来事の因果関係を見える形でつなぐ
- 最初の数見開きで主人公・願い・問題のいずれかを出す
- 各見開きの終わりに次をめくりたくなる引力を置く（最終見開きを除く）
- 終わりは解決後に少し余韻を残す（説教で終わらせない）
- 子どもの体感に近い視点を保つ

### 言語・文体（最重要）
- **ひらがな・カタカナを中心に書く。漢字は使わない。**
- 例: 「幼稚園」→「ようちえん」、「友達」→「ともだち」、「一緒」→「いっしょ」
- 声に出して自然な文にする
- 1文は短く、1文1つの意味
- 抽象語より具体語を優先する
- 動詞中心で動きを出す
- 難語・説明言葉・大人の語彙を控える
- セリフは短く、話者が混乱しないようにする
- 文体・表記を一冊の中で統一する

### 改行ルール
- 改行は息・意味・絵のまとまりに沿って入れる
- 句として一緒に読まれるものを分断しない

### 文章と絵の関係
- 文章で全部説明しない（絵に任せる部分を残す）
- 各見開きに描ける場面がある

### 倫理・安全
- 子どもを見下さない
- 説教で終わらせない
- 暴力的・性的・恐怖を与える内容は絶対に含めない`;
}

function buildGreeting(characters: CharacterSummary[]): string {
  if (characters.length === 0) {
    return 'こんにちは！一緒に素敵な絵本を作りましょう😊\nどんなお話にしたいですか？たとえば「冒険」「動物」「家族のお出かけ」など、なんでも教えてください！';
  }

  const names = characters.map((c) => c.name).join('と');
  const rolesText = characters
    .map((c) => {
      const roleMap: Record<string, string> = {
        protagonist: '主人公',
        papa: 'パパ',
        mama: 'ママ',
        sibling: '兄弟・姉妹',
        other: 'その他',
      };
      return `${c.name}（${roleMap[c.role] ?? c.role}）`;
    })
    .join('、');

  return `こんにちは！一緒に素敵な絵本を作りましょう😊\n\n登場人物は ${rolesText} ですね。\n\nどんなお話にしたいですか？たとえば「公園でのぼうけん」「動物と友だちになる話」「家族でお出かけ」など、思い浮かぶことを教えてください！`;
}

function sendSSE(res: Response, event: ChatSSEEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// --- Session management ---

export async function createSession(
  userId: string,
  characters: CharacterSummary[]
): Promise<string> {
  const now = Timestamp.now();
  const systemPrompt = buildSystemPrompt(characters);
  const greeting = buildGreeting(characters);

  const doc = {
    title: '新しいストーリー',
    characters,
    messages: [
      {
        role: 'system' as const,
        content: systemPrompt,
        timestamp: now,
      },
      {
        role: 'assistant' as const,
        content: greeting,
        timestamp: now,
      },
    ],
    draft: null,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await getSessionsCollection(userId).add(doc);
  return ref.id;
}

export async function getSession(
  userId: string,
  sessionId: string
): Promise<{
  id: string;
  title: string;
  characters: CharacterSummary[];
  messages: ChatMessage[];
  draft: StoryDraft | null;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: string;
  updatedAt: string;
} | null> {
  const snap = await getSessionsCollection(userId).doc(sessionId).get();
  if (!snap.exists) {
    return null;
  }

  const d = snap.data()!;
  return {
    id: snap.id,
    title: d.title as string,
    characters: d.characters as CharacterSummary[],
    messages: (d.messages as Array<{ role: string; content: string; timestamp: Timestamp }>)
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
        timestamp: m.timestamp.toDate().toISOString(),
      })),
    draft: d.draft as StoryDraft | null,
    status: d.status as 'active' | 'completed' | 'abandoned',
    createdAt: (d.createdAt as Timestamp).toDate().toISOString(),
    updatedAt: (d.updatedAt as Timestamp).toDate().toISOString(),
  };
}

export async function getSessions(
  userId: string
): Promise<
  Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>
> {
  const snap = await getSessionsCollection(userId)
    .orderBy('createdAt', 'desc')
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      title: d.title as string,
      status: d.status as string,
      createdAt: (d.createdAt as Timestamp).toDate().toISOString(),
      updatedAt: (d.updatedAt as Timestamp).toDate().toISOString(),
    };
  });
}

// --- Chat (SSE streaming) ---

export async function sendMessage(
  userId: string,
  sessionId: string,
  message: string,
  res: Response
): Promise<void> {
  // 1. Content filter check on user message
  const filterResult = await checkText(message);
  if (!filterResult.safe) {
    sendSSE(res, {
      type: 'content_filtered',
      message: '不適切な内容が含まれています。別のメッセージをお試しください。',
    });
    res.end();
    return;
  }

  // 2. Get session and check message count limit
  const sessionRef = getSessionsCollection(userId).doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    sendSSE(res, { type: 'error', message: 'セッションが見つかりません。' });
    res.end();
    return;
  }

  const sessionData = sessionSnap.data()!;
  const messages = sessionData.messages as Array<{
    role: string;
    content: string;
    timestamp: Timestamp;
  }>;

  if (messages.length >= MAX_CHAT_MESSAGES) {
    sendSSE(res, {
      type: 'error',
      message: `メッセージ数の上限（${MAX_CHAT_MESSAGES}件）に達しました。`,
    });
    res.end();
    return;
  }

  // 3. Save user message to session
  const now = Timestamp.now();
  const userMessage = {
    role: 'user' as const,
    content: message,
    timestamp: now,
  };
  messages.push(userMessage);
  await sessionRef.update({ messages, updatedAt: now });

  // 4. Call GPT-4o with streaming, passing full conversation history
  try {
    const client = createOpenAIClient();
    const openaiMessages = messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      stream: true,
    });

    // 5. Stream response chunks via SSE
    let fullContent = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        sendSSE(res, { type: 'chunk', content: delta });
      }
    }

    // 6. On completion: save assistant message, send done event
    const assistantMessage = {
      role: 'assistant' as const,
      content: fullContent,
      timestamp: Timestamp.now(),
    };
    messages.push(assistantMessage);
    await sessionRef.update({ messages, updatedAt: Timestamp.now() });

    sendSSE(res, { type: 'done', messageId: `msg-${Date.now()}` });
    res.end();
  } catch (error) {
    // 7. On error: send error event
    const errorMessage =
      error instanceof Error ? error.message : '不明なエラーが発生しました。';
    sendSSE(res, { type: 'error', message: errorMessage });
    res.end();
  }
}

// --- Draft management ---

const DRAFT_GENERATION_PROMPT = `これまでの会話内容に基づいて、絵本のストーリーを以下のJSON形式で構造化してください。
必ず有効なJSONのみを返してください。説明文は不要です。

{
  "title": "ストーリータイトル",
  "pages": [
    { "pageNumber": 1, "text": "テキスト", "roles": ["protagonist", "papa"], "outfit": "[protagonist] ... [papa] ..." }
  ],
  "roles": [
    { "role": "protagonist", "label": "主人公", "required": true }
  ]
}`;

export async function generateDraft(
  userId: string,
  sessionId: string
): Promise<StoryDraft> {
  const sessionRef = getSessionsCollection(userId).doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new Error('セッションが見つかりません。');
  }

  const sessionData = sessionSnap.data()!;
  const messages = sessionData.messages as Array<{
    role: string;
    content: string;
    timestamp: Timestamp;
  }>;

  const client = createOpenAIClient();
  const openaiMessages = [
    ...messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: DRAFT_GENERATION_PROMPT },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: openaiMessages,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('ドラフト生成に失敗しました。');
  }

  const parsed = JSON.parse(content) as StoryDraft;
  const draft: StoryDraft = {
    title: parsed.title,
    pages: parsed.pages,
    roles: parsed.roles,
  };

  // Save draft to session
  await sessionRef.update({
    draft,
    updatedAt: Timestamp.now(),
  });

  return draft;
}

export async function saveDraftAsTemplate(
  userId: string,
  sessionId: string,
  isPublic: boolean
): Promise<string> {
  const sessionRef = getSessionsCollection(userId).doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new Error('セッションが見つかりません。');
  }

  const sessionData = sessionSnap.data()!;
  const draft = sessionData.draft as StoryDraft | null;
  if (!draft) {
    throw new Error('ドラフトが存在しません。先にドラフトを生成してください。');
  }

  const creatorId = isPublic ? null : userId;

  const templateResult = await createTemplate(
    {
      title: draft.title,
      description: `チャットで作成されたストーリー`,
      ageRange: { min: 3, max: 8 },
      theme: 'adventure',
      roles: draft.roles,
      pages: draft.pages.map((p) => ({
        pageNumber: p.pageNumber,
        textTemplate: p.text,
        roles: p.roles,
        outfitTemplate: p.outfit,
      })),
    },
    creatorId
  );

  // Override source to 'chat'
  const db = getDb();
  await db.collection('storyTemplates').doc(templateResult.id).update({
    source: 'chat',
  });

  // Update session status
  await sessionRef.update({
    status: 'completed',
    updatedAt: Timestamp.now(),
  });

  return templateResult.id;
}
