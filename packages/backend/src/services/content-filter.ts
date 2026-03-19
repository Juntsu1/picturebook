import OpenAI from 'openai';
import { createOpenAIClient } from '../lib/openai.js';

export interface ContentCheckResult {
  safe: boolean;
  flaggedCategories: string[];
}

export class ContentFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentFilterError';
  }
}

const RETRY_DELAYS = [1000, 2000, 4000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < RETRY_DELAYS.length) {
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  throw new ContentFilterError(
    `コンテンツチェックに失敗しました: ${lastError?.message ?? '不明なエラー'}`
  );
}

export async function checkText(
  text: string,
  openaiClient?: OpenAI
): Promise<ContentCheckResult> {
  const client = openaiClient ?? createOpenAIClient();

  return withRetry(async () => {
    const response = await client.moderations.create({
      input: text,
    });

    const result = response.results[0];
    if (!result) {
      throw new Error('モデレーションAPIからの応答が空です');
    }

    const flaggedCategories: string[] = [];
    const categories = result.categories as unknown as Record<string, boolean>;
    for (const [category, flagged] of Object.entries(categories)) {
      if (flagged) {
        flaggedCategories.push(category);
      }
    }

    return {
      safe: !result.flagged,
      flaggedCategories,
    };
  });
}

export async function checkImage(
  imageUrl: string,
  openaiClient?: OpenAI
): Promise<ContentCheckResult> {
  const client = openaiClient ?? createOpenAIClient();

  return withRetry(async () => {
    const response = await client.moderations.create({
      model: 'omni-moderation-latest',
      input: [{ type: 'image_url', image_url: { url: imageUrl } }],
    });

    const result = response.results[0];
    if (!result) {
      throw new Error('モデレーションAPIからの応答が空です');
    }

    const flaggedCategories: string[] = [];
    const categories = result.categories as unknown as Record<string, boolean>;
    for (const [category, flagged] of Object.entries(categories)) {
      if (flagged) {
        flaggedCategories.push(category);
      }
    }

    return {
      safe: !result.flagged,
      flaggedCategories,
    };
  });
}

// Exported for testing
export { withRetry };
