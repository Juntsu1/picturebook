import type { Theme } from './types.js';

export const THEME_LABELS: Record<Theme, string> = {
  adventure: '冒険',
  animals: '動物',
  space: '宇宙',
  ocean: '海',
  magic: '魔法',
  friendship: '友情',
};

export const PHOTO_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export const PHOTO_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const MAX_CHARACTERS_PER_USER = 10;

export const MAX_CHAT_MESSAGES = 50;

export const CHARACTER_ROLES: Record<string, string> = {
  protagonist: '主人公',
  papa: 'パパ',
  mama: 'ママ',
  sibling: '兄弟',
  other: 'その他',
};
