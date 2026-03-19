import { describe, it, expect, vi } from 'vitest';
import { checkText, checkImage } from '../content-filter.js';

function createMockOpenAI(moderationResult: {
  flagged: boolean;
  categories: Record<string, boolean>;
}) {
  return {
    moderations: {
      create: vi.fn().mockResolvedValue({
        results: [
          {
            flagged: moderationResult.flagged,
            categories: moderationResult.categories,
          },
        ],
      }),
    },
  } as any;
}

describe('ContentFilter', () => {
  describe('checkText', () => {
    it('returns safe=true for clean text', async () => {
      const client = createMockOpenAI({
        flagged: false,
        categories: { violence: false, sexual: false, hate: false },
      });

      const result = await checkText('たろうは元気に遊びました', client);
      expect(result.safe).toBe(true);
      expect(result.flaggedCategories).toHaveLength(0);
    });

    it('returns safe=false with flagged categories for unsafe text', async () => {
      const client = createMockOpenAI({
        flagged: true,
        categories: { violence: true, sexual: false, hate: false },
      });

      const result = await checkText('unsafe content', client);
      expect(result.safe).toBe(false);
      expect(result.flaggedCategories).toContain('violence');
    });

    it('returns multiple flagged categories', async () => {
      const client = createMockOpenAI({
        flagged: true,
        categories: { violence: true, sexual: true, hate: false },
      });

      const result = await checkText('bad content', client);
      expect(result.safe).toBe(false);
      expect(result.flaggedCategories).toEqual(['violence', 'sexual']);
    });

    it('retries on failure and succeeds', async () => {
      const client = {
        moderations: {
          create: vi
            .fn()
            .mockRejectedValueOnce(new Error('API error'))
            .mockResolvedValueOnce({
              results: [
                {
                  flagged: false,
                  categories: { violence: false },
                },
              ],
            }),
        },
      } as any;

      const result = await checkText('test', client);
      expect(result.safe).toBe(true);
      expect(client.moderations.create).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries exhausted', async () => {
      const client = {
        moderations: {
          create: vi.fn().mockRejectedValue(new Error('persistent error')),
        },
      } as any;

      await expect(checkText('test', client)).rejects.toThrow('コンテンツチェックに失敗しました');
      // 1 initial + 3 retries = 4 calls
      expect(client.moderations.create).toHaveBeenCalledTimes(4);
    }, 15000);
  });

  describe('checkImage', () => {
    it('returns safe=true for clean image', async () => {
      const client = createMockOpenAI({
        flagged: false,
        categories: { violence: false, sexual: false },
      });

      const result = await checkImage('https://example.com/image.png', client);
      expect(result.safe).toBe(true);
      expect(result.flaggedCategories).toHaveLength(0);
    });

    it('returns safe=false for flagged image', async () => {
      const client = createMockOpenAI({
        flagged: true,
        categories: { violence: true, sexual: false },
      });

      const result = await checkImage('https://example.com/bad.png', client);
      expect(result.safe).toBe(false);
      expect(result.flaggedCategories).toContain('violence');
    });

    it('passes image_url format to moderation API', async () => {
      const client = createMockOpenAI({
        flagged: false,
        categories: {},
      });

      await checkImage('https://example.com/img.png', client);
      expect(client.moderations.create).toHaveBeenCalledWith({
        model: 'omni-moderation-latest',
        input: [{ type: 'image_url', image_url: { url: 'https://example.com/img.png' } }],
      });
    });
  });
});
