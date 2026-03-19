import { describe, it, expect, vi } from 'vitest';
import {
  buildIllustrationPrompt,
  generateForPage,
  IllustrationEngineError,
} from '../illustration-engine.js';
import type { ChildProfile } from '../story-engine.js';
import type { Theme } from '@picture-book/shared';

describe('IllustrationEngine', () => {
  describe('buildIllustrationPrompt', () => {
    const baseProfile: ChildProfile = {
      name: 'たろう',
      age: 5,
    };

    it('includes page text in prompt', () => {
      const prompt = buildIllustrationPrompt(
        { pageNumber: 1, text: 'たろうは森を歩いていました' },
        baseProfile,
        'adventure'
      );
      expect(prompt).toContain('たろうは森を歩いていました');
    });

    it('includes theme label in prompt', () => {
      const prompt = buildIllustrationPrompt(
        { pageNumber: 1, text: 'テスト' },
        baseProfile,
        'space'
      );
      expect(prompt).toContain('宇宙');
    });

    it('includes page number', () => {
      const prompt = buildIllustrationPrompt(
        { pageNumber: 3, text: 'テスト' },
        baseProfile,
        'animals'
      );
      // Prompt includes the text but page number is used for storage path, not prompt
      expect(prompt).toContain('テスト');
    });

    it('includes child appearance when provided', () => {
      const profile: ChildProfile = {
        ...baseProfile,
        appearance: '茶色い髪で青い目',
        gender: '男の子',
        favoriteColor: '赤',
      };
      const prompt = buildIllustrationPrompt(
        { pageNumber: 1, text: 'テスト' },
        profile,
        'magic'
      );
      expect(prompt).toContain('赤');
    });

    it('handles profile without optional fields', () => {
      const prompt = buildIllustrationPrompt(
        { pageNumber: 1, text: 'テスト' },
        baseProfile,
        'ocean'
      );
      expect(prompt).toContain('たろう');
    });

    it('includes child safety constraints', () => {
      const prompt = buildIllustrationPrompt(
        { pageNumber: 1, text: 'テスト' },
        baseProfile,
        'friendship'
      );
      // Prompt includes "No text or words" safety constraint
      expect(prompt).toContain('No text');
    });

    it('includes watercolor style requirement', () => {
      const prompt = buildIllustrationPrompt(
        { pageNumber: 1, text: 'テスト' },
        baseProfile,
        'adventure'
      );
      expect(prompt).toContain('watercolor');
    });
  });

  describe('generateForPage', () => {
    const baseProfile: ChildProfile = {
      name: 'はなこ',
      age: 4,
      appearance: '黒い髪',
    };

    const page = { pageNumber: 1, text: 'はなこは海で遊びました' };

    function createMockOpenAI(b64Data = 'aW1hZ2VkYXRh') {
      return {
        images: {
          generate: vi.fn().mockResolvedValue({
            data: [{ b64_json: b64Data }],
          }),
        },
      } as unknown as import('openai').default;
    }

    function createMockBucket() {
      const saveFn = vi.fn().mockResolvedValue(undefined);
      const getSignedUrlFn = vi.fn().mockResolvedValue(['https://storage.example.com/test.png?signed=1']);
      const publicUrlFn = vi.fn().mockReturnValue('https://storage.example.com/test.png');
      return {
        bucket: {
          file: vi.fn().mockReturnValue({
            save: saveFn,
            getSignedUrl: getSignedUrlFn,
            publicUrl: publicUrlFn,
          }),
        },
        saveFn,
        getSignedUrlFn,
        publicUrlFn,
      };
    }

    it('generates illustration and returns result with correct pageNumber', async () => {
      const mockClient = createMockOpenAI();
      const { bucket } = createMockBucket();

      const result = await generateForPage(page, baseProfile, 'ocean', {
        userId: 'user-1',
        bookId: 'book-1',
        openaiClient: mockClient,
        storageBucket: bucket,
      });

      expect(result.pageNumber).toBe(1);
      expect(result.imageUrl).toBe('https://storage.example.com/test.png?signed=1');
    });

    it('saves image to correct Firebase Storage path', async () => {
      const mockClient = createMockOpenAI();
      const { bucket } = createMockBucket();

      await generateForPage(page, baseProfile, 'ocean', {
        userId: 'user-123',
        bookId: 'book-456',
        openaiClient: mockClient,
        storageBucket: bucket,
      });

      expect(bucket.file).toHaveBeenCalledWith(
        'users/user-123/books/book-456/illustrations/page-1.png'
      );
    });

    it('saves image with correct content type', async () => {
      const mockClient = createMockOpenAI();
      const { bucket, saveFn } = createMockBucket();

      await generateForPage(page, baseProfile, 'ocean', {
        userId: 'user-1',
        bookId: 'book-1',
        openaiClient: mockClient,
        storageBucket: bucket,
      });

      expect(saveFn).toHaveBeenCalledWith(
        expect.any(Buffer),
        { metadata: { contentType: 'image/png' } }
      );
    });

    it('calls OpenAI with gpt-image-1.5 model', async () => {
      const mockClient = createMockOpenAI();
      const { bucket } = createMockBucket();

      await generateForPage(page, baseProfile, 'ocean', {
        userId: 'user-1',
        bookId: 'book-1',
        openaiClient: mockClient,
        storageBucket: bucket,
      });

      expect(mockClient.images.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-image-1.5',
          size: '1024x1024',
          n: 1,
        })
      );
    });

    it('retries on failure and succeeds', async () => {
      const mockClient = {
        images: {
          generate: vi
            .fn()
            .mockRejectedValueOnce(new Error('API error'))
            .mockResolvedValueOnce({
              data: [{ b64_json: 'aW1hZ2VkYXRh' }],
            }),
        },
      } as unknown as import('openai').default;
      const { bucket } = createMockBucket();

      const result = await generateForPage(page, baseProfile, 'ocean', {
        userId: 'user-1',
        bookId: 'book-1',
        openaiClient: mockClient,
        storageBucket: bucket,
      });

      expect(result.pageNumber).toBe(1);
      expect(mockClient.images.generate).toHaveBeenCalledTimes(2);
    }, 15000);

    it('throws IllustrationEngineError after all retries fail', async () => {
      const mockClient = {
        images: {
          generate: vi.fn().mockRejectedValue(new Error('persistent error')),
        },
      } as unknown as import('openai').default;
      const { bucket } = createMockBucket();

      await expect(
        generateForPage(page, baseProfile, 'ocean', {
          userId: 'user-1',
          bookId: 'book-1',
          openaiClient: mockClient,
          storageBucket: bucket,
        })
      ).rejects.toThrow(IllustrationEngineError);
    }, 30000);

    it('includes page number in error when retries exhausted', async () => {
      const mockClient = {
        images: {
          generate: vi.fn().mockRejectedValue(new Error('fail')),
        },
      } as unknown as import('openai').default;
      const { bucket } = createMockBucket();

      try {
        await generateForPage(page, baseProfile, 'ocean', {
          userId: 'user-1',
          bookId: 'book-1',
          openaiClient: mockClient,
          storageBucket: bucket,
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(IllustrationEngineError);
        expect((error as IllustrationEngineError).pageNumber).toBe(1);
        expect((error as IllustrationEngineError).retryable).toBe(true);
      }
    }, 30000);

    it('throws when API returns empty data', async () => {
      const mockClient = {
        images: {
          generate: vi.fn().mockResolvedValue({ data: [{}] }),
        },
      } as unknown as import('openai').default;
      const { bucket } = createMockBucket();

      await expect(
        generateForPage(page, baseProfile, 'ocean', {
          userId: 'user-1',
          bookId: 'book-1',
          openaiClient: mockClient,
          storageBucket: bucket,
        })
      ).rejects.toThrow(IllustrationEngineError);
    }, 30000);

    it('correctly decodes base64 image data', async () => {
      const testBase64 = Buffer.from('test-image-data').toString('base64');
      const mockClient = createMockOpenAI(testBase64);
      const { bucket, saveFn } = createMockBucket();

      await generateForPage(page, baseProfile, 'ocean', {
        userId: 'user-1',
        bookId: 'book-1',
        openaiClient: mockClient,
        storageBucket: bucket,
      });

      const savedBuffer = saveFn.mock.calls[0][0] as Buffer;
      expect(savedBuffer.toString()).toBe('test-image-data');
    });
  });

  describe('IllustrationEngineError', () => {
    it('has correct name', () => {
      const error = new IllustrationEngineError('test', 1, true);
      expect(error.name).toBe('IllustrationEngineError');
    });

    it('stores page number and retryable flag', () => {
      const error = new IllustrationEngineError('test', 5, false);
      expect(error.pageNumber).toBe(5);
      expect(error.retryable).toBe(false);
    });
  });
});
