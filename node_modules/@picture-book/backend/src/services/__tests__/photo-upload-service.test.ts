import { describe, it, expect, vi } from 'vitest';
import {
  uploadPhoto,
  PhotoUploadError,
} from '../photo-upload-service.js';
import type { ContentCheckResult } from '../content-filter.js';

function createMockBucket(storage: Map<string, Buffer> = new Map()) {
  return {
    file: (path: string) => ({
      save: vi.fn(async (data: Buffer) => {
        storage.set(path, data);
      }),
      getSignedUrl: vi.fn(async () => [`https://storage.example.com/${path}?signed=true`]),
      publicUrl: () => `https://storage.example.com/${path}`,
      delete: vi.fn(async () => {
        storage.delete(path);
      }),
      download: vi.fn(async () => [storage.get(path) ?? Buffer.alloc(0)]),
    }),
  };
}

describe('uploadPhoto content filter integration', () => {
  const userId = 'user-1';
  const profileId = 'profile-1';
  const fileBuffer = Buffer.from('fake-png-data');

  it('proceeds with upload when checkImage returns safe=true', async () => {
    const storage = new Map<string, Buffer>();
    const mockBucket = createMockBucket(storage);
    const safeCheck = vi.fn(async (): Promise<ContentCheckResult> => ({
      safe: true,
      flaggedCategories: [],
    }));

    const result = await uploadPhoto(userId, profileId, fileBuffer, {
      storageBucket: mockBucket,
      checkImageFn: safeCheck,
    });

    expect(safeCheck).toHaveBeenCalledOnce();
    // Verify it was called with a base64 data URL
    const callArg = (safeCheck.mock.calls as unknown as string[][])[0][0];
    expect(callArg).toMatch(/^data:image\/png;base64,/);
    // Verify the base64 content matches the buffer
    const base64Part = callArg.replace('data:image/png;base64,', '');
    expect(Buffer.from(base64Part, 'base64').toString()).toBe('fake-png-data');

    expect(result.storagePath).toBe(`users/${userId}/profiles/${profileId}/photo.png`);
    expect(result.photoUrl).toContain('storage.example.com');
    // File was saved to storage
    expect(storage.has(`users/${userId}/profiles/${profileId}/photo.png`)).toBe(true);
  });

  it('throws PhotoUploadError and does NOT save when checkImage returns safe=false', async () => {
    const storage = new Map<string, Buffer>();
    const mockBucket = createMockBucket(storage);
    const unsafeCheck = vi.fn(async (): Promise<ContentCheckResult> => ({
      safe: false,
      flaggedCategories: ['violence'],
    }));

    await expect(
      uploadPhoto(userId, profileId, fileBuffer, {
        storageBucket: mockBucket,
        checkImageFn: unsafeCheck,
      })
    ).rejects.toThrow(PhotoUploadError);

    await expect(
      uploadPhoto(userId, profileId, fileBuffer, {
        storageBucket: mockBucket,
        checkImageFn: unsafeCheck,
      })
    ).rejects.toThrow('アップロードされた画像は使用できません。別の画像をお試しください');

    // Storage should remain empty — file was never saved
    expect(storage.size).toBe(0);
  });

  it('PhotoUploadError has correct name property', () => {
    const err = new PhotoUploadError('test');
    expect(err.name).toBe('PhotoUploadError');
    expect(err).toBeInstanceOf(Error);
  });
});
