import type { z } from 'zod';
import type { ThemeSchema } from './schemas.js';

// テーマ型 (derived from Zod schema)
export type Theme = z.infer<typeof ThemeSchema>;

// 絵本のステータス
export type BookStatus = 'generating' | 'completed' | 'error';

// ページデータ
export interface PageData {
  pageNumber: number;
  text: string;
  originalText: string;
  imageUrl: string;
}

// 絵本データ（レンダリング用）
export interface BookData {
  id: string;
  title: string;
  theme: Theme;
  pages: PageData[];
  profile: {
    name: string;
    age: number;
  };
}

// プロフィールレスポンス
export interface ProfileResponse {
  id: string;
  name: string;
  age: number;
  gender?: string;
  favoriteColor?: string;
  favoriteAnimal?: string;
  appearance?: string;
  photoUrl?: string;
  createdAt: string;
}

// SSE 進捗イベント
export type ProgressEvent =
  | { type: 'story_generating' }
  | { type: 'story_complete'; title: string; pageCount: number }
  | { type: 'character_sheets_checking' }
  | { type: 'illustration_generating'; pageNumber: number; totalPages: number }
  | { type: 'illustration_complete'; pageNumber: number }
  | { type: 'complete'; bookId: string }
  | { type: 'error'; message: string; retryable: boolean };

// キャラクター役割
export type CharacterRole = 'protagonist' | 'papa' | 'mama' | 'sibling' | 'other';

// キャラクタープロフィール
export interface CharacterProfile {
  name: string;
  role: CharacterRole;
  age: number | null;
  gender: string | null;
  appearance: string | null;
  photoStoragePath: string | null;
  photoUrl: string | null;
  characterSheetPath: string | null;
  characterSheetStatus: 'none' | 'generating' | 'completed' | 'failed';
  appearanceDescription: string | null;
  createdAt: string;
  updatedAt: string;
}

// テンプレートロール
export interface TemplateRole {
  role: string;
  label: string;
  required: boolean;
}

// ページテンプレート
export interface PageTemplate {
  pageNumber: number;
  textTemplate: string;
  roles: string[];
  outfitTemplate: string;
}

// ストーリーテンプレート
export interface StoryTemplate {
  id: string;
  title: string;
  description: string;
  ageRange: { min: number; max: number };
  theme: Theme;
  roles: TemplateRole[];
  pages: PageTemplate[];
  archived: boolean;
  source: 'admin' | 'chat';
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
}

// チャットメッセージ
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

// キャラクターサマリー
export interface CharacterSummary {
  characterId: string;
  name: string;
  role: string;
  age: number | null;
}

// ストーリードラフトページ
export interface DraftPage {
  pageNumber: number;
  text: string;
  roles: string[];
  outfit: string;
}

// ストーリードラフト
export interface StoryDraft {
  title: string;
  pages: DraftPage[];
  roles: TemplateRole[];
}

// チャットセッション
export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  characters: CharacterSummary[];
  messages: ChatMessage[];
  draft: StoryDraft | null;
  status: 'active' | 'completed' | 'abandoned';
  createdAt: string;
  updatedAt: string;
}

// マルチキャラクター進捗イベント
export type MultiProgressEvent =
  | { type: 'story_generating' }
  | { type: 'story_complete'; title: string; pageCount: number }
  | { type: 'character_sheets_checking' }
  | { type: 'illustration_generating'; pageNumber: number; totalPages: number }
  | { type: 'illustration_complete'; pageNumber: number }
  | { type: 'complete'; bookId: string }
  | { type: 'error'; message: string; retryable: boolean };

// チャット SSE イベント
export type ChatSSEEvent =
  | { type: 'chunk'; content: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string }
  | { type: 'content_filtered'; message: string };
