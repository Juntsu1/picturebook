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
  const characterLines = characters
    .map((c) => `- ${c.name}（${c.role}、${c.age ?? '不明'}歳）`)
    .join('\n');

  return `あなたは子供向け絵本のストーリー作家アシスタントです。
ユーザーと対話しながら、オリジナルの絵本ストーリーを一緒に作ります。

## 登録済みキャラクター
${characterLines}

## ルール
- 子供向けの安全で楽しいストーリーのみ提案してください
- 暴力的、性的、恐怖を与える内容は絶対に含めないでください
- ユーザーの希望を聞きながら、ストーリーの展開を提案してください
- 各ページは短い文章（対象年齢に応じて15〜80文字）にしてください`;
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

  const doc = {
    title: '新しいストーリー',
    characters,
    messages: [
      {
        role: 'system' as const,
        content: systemPrompt,
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
    messages: (d.messages as Array<{ role: string; content: string; timestamp: Timestamp }>).map(
      (m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
        timestamp: m.timestamp.toDate().toISOString(),
      })
    ),
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
