import { z } from 'zod';

export const ThemeSchema = z.enum([
  'adventure',
  'animals',
  'space',
  'ocean',
  'magic',
  'friendship',
]);

export const CreateProfileSchema = z.object({
  name: z.string().min(1, '名前は必須です').max(50, '名前は50文字以内で入力してください'),
  age: z.number().int().min(0, '年齢は0歳以上で入力してください').max(17, '年齢は17歳以下で入力してください'),
  gender: z.string().optional(),
  favoriteColor: z.string().optional(),
  favoriteAnimal: z.string().optional(),
  appearance: z.string().optional(),
});

export const GenerateBookSchema = z.object({
  profileId: z.string().min(1, 'プロフィールIDは必須です'),
  theme: ThemeSchema,
  pageCount: z.number().int().min(1).max(16).optional(),
  requestId: z.string().uuid('リクエストIDはUUID形式で指定してください').optional(),
});

export const UpdatePageSchema = z.object({
  text: z.string().max(200, 'テキストは200文字以内で入力してください'),
});

export const RegisterSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください'),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const PhotoUploadSchema = z.object({
  mimetype: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().max(10 * 1024 * 1024),
});

export const CharacterRoleSchema = z.enum([
  'protagonist',
  'papa',
  'mama',
  'sibling',
  'other',
]);

export const CreateCharacterSchema = z.object({
  name: z.string().min(1, '名前は必須です').max(50),
  role: CharacterRoleSchema,
  age: z.number().int().min(0).max(120).optional(),
  gender: z.string().optional(),
  appearance: z.string().max(500).optional(),
});

export const UpdateCharacterSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  role: CharacterRoleSchema.optional(),
  age: z.number().int().min(0).max(120).optional(),
  gender: z.string().optional(),
  appearance: z.string().max(500).optional(),
});

export const CreateTemplateSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(500),
  ageRange: z.object({
    min: z.number().int().min(0),
    max: z.number().int().max(17),
  }),
  theme: ThemeSchema,
  roles: z.array(z.object({
    role: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
  })).min(1),
  pages: z.array(z.object({
    pageNumber: z.number().int().min(1),
    textTemplate: z.string().min(1),
    roles: z.array(z.string()).min(1),
    outfitTemplate: z.string(),
  })).min(1).max(16),
});

export const GenerateMultiBookSchema = z.object({
  templateId: z.string().min(1),
  characterAssignments: z.record(z.string(), z.string()),
  pageCount: z.number().int().min(1).max(16).optional(),
  requestId: z.string().uuid('リクエストIDはUUID形式で指定してください').optional(),
});

export const ChatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});
