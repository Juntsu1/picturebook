import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

// ── In-memory Firestore mock ────────────────────────────────────────────────

interface MockDoc {
  id: string;
  data: Record<string, unknown>;
}

function createMockFirestore() {
  // Keyed by full path: "users/{userId}/childProfiles"
  const collections: Record<string, MockDoc[]> = {};

  function getCollection(path: string): MockDoc[] {
    if (!collections[path]) collections[path] = [];
    return collections[path];
  }

  let idCounter = 0;

  const firestore = {
    collection(name: string) {
      return {
        doc(docId: string) {
          return {
            collection(subName: string) {
              const path = `${name}/${docId}/${subName}`;
              return {
                async add(data: Record<string, unknown>) {
                  const id = `profile-${++idCounter}`;
                  getCollection(path).push({ id, data: { ...data } });
                  return { id };
                },
                orderBy(_field: string, _dir: string) {
                  return {
                    async get() {
                      const docs = getCollection(path);
                      return {
                        docs: docs.map((d) => ({
                          id: d.id,
                          data: () => ({ ...d.data }),
                          exists: true,
                        })),
                      };
                    },
                  };
                },
                doc(profileId: string) {
                  return {
                    async get() {
                      const found = getCollection(path).find(
                        (d) => d.id === profileId,
                      );
                      if (!found) {
                        return { exists: false, id: profileId, data: () => undefined };
                      }
                      return {
                        exists: true,
                        id: found.id,
                        data: () => ({ ...found.data }),
                      };
                    },
                    async update(fields: Record<string, unknown>) {
                      const found = getCollection(path).find(
                        (d) => d.id === profileId,
                      );
                      if (!found) throw new Error('Document not found');
                      Object.assign(found.data, fields);
                    },
                    async delete() {
                      const col = getCollection(path);
                      const idx = col.findIndex((d) => d.id === profileId);
                      if (idx !== -1) col.splice(idx, 1);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    firestore,
    reset: () => {
      Object.keys(collections).forEach((k) => delete collections[k]);
      idCounter = 0;
    },
  };
}

const mockFs = createMockFirestore();

vi.mock('../../lib/firebase.js', () => ({
  getDb: () => mockFs.firestore,
  initFirebase: () => {},
}));

const { createProfile, getProfiles, getProfileById, updateProfilePhoto, clearProfilePhoto, deleteProfile } = await import(
  '../profile-service.js'
);

// ── Tests ───────────────────────────────────────────────────────────────────

describe('profile-service', () => {
  beforeEach(() => {
    mockFs.reset();
  });

  describe('createProfile', () => {
    it('必須項目のみで子供プロフィールを作成できる', async () => {
      const profile = await createProfile('user-1', {
        name: 'たろう',
        age: 5,
      });

      expect(profile.id).toBeTruthy();
      expect(profile.name).toBe('たろう');
      expect(profile.age).toBe(5);
      expect(profile.createdAt).toBeTruthy();
      // Optional fields should not be present
      expect(profile.gender).toBeUndefined();
      expect(profile.favoriteColor).toBeUndefined();
    });

    it('全項目を指定して子供プロフィールを作成できる', async () => {
      const profile = await createProfile('user-1', {
        name: 'はなこ',
        age: 8,
        gender: '女の子',
        favoriteColor: 'ピンク',
        favoriteAnimal: 'うさぎ',
        appearance: '長い黒髪',
      });

      expect(profile.name).toBe('はなこ');
      expect(profile.age).toBe(8);
      expect(profile.gender).toBe('女の子');
      expect(profile.favoriteColor).toBe('ピンク');
      expect(profile.favoriteAnimal).toBe('うさぎ');
      expect(profile.appearance).toBe('長い黒髪');
    });
  });

  describe('getProfiles', () => {
    it('ユーザーの全プロフィールを取得できる', async () => {
      await createProfile('user-1', { name: 'たろう', age: 5 });
      await createProfile('user-1', { name: 'はなこ', age: 8 });

      const profiles = await getProfiles('user-1');
      expect(profiles).toHaveLength(2);
    });

    it('プロフィールが無い場合は空配列を返す', async () => {
      const profiles = await getProfiles('user-empty');
      expect(profiles).toHaveLength(0);
    });
  });

  describe('getProfileById', () => {
    it('IDでプロフィールを取得できる', async () => {
      const created = await createProfile('user-1', {
        name: 'たろう',
        age: 5,
      });

      const profile = await getProfileById('user-1', created.id);
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe('たろう');
      expect(profile!.age).toBe(5);
    });

    it('存在しないIDの場合はnullを返す', async () => {
      const profile = await getProfileById('user-1', 'nonexistent');
      expect(profile).toBeNull();
    });
  });

  describe('createProfile with photo fields', () => {
    it('photoUrl と photoStoragePath を指定してプロフィールを作成できる', async () => {
      const profile = await createProfile('user-1', {
        name: 'たろう',
        age: 5,
        photoUrl: 'https://storage.example.com/photo.png',
        photoStoragePath: 'users/user-1/profiles/p1/photo.png',
      });

      expect(profile.photoUrl).toBe('https://storage.example.com/photo.png');
    });

    it('写真なしで作成した場合 photoUrl は undefined', async () => {
      const profile = await createProfile('user-1', {
        name: 'たろう',
        age: 5,
      });

      expect(profile.photoUrl).toBeUndefined();
    });
  });

  describe('updateProfilePhoto', () => {
    it('プロフィールの写真URLとStorageパスを更新できる', async () => {
      const created = await createProfile('user-1', { name: 'たろう', age: 5 });

      await updateProfilePhoto(
        'user-1',
        created.id,
        'https://storage.example.com/new-photo.png',
        'users/user-1/profiles/p1/photo.png'
      );

      const updated = await getProfileById('user-1', created.id);
      expect(updated!.photoUrl).toBe('https://storage.example.com/new-photo.png');
    });
  });

  describe('clearProfilePhoto', () => {
    it('プロフィールの写真をクリアできる', async () => {
      const created = await createProfile('user-1', {
        name: 'たろう',
        age: 5,
        photoUrl: 'https://storage.example.com/photo.png',
        photoStoragePath: 'users/user-1/profiles/p1/photo.png',
      });

      await clearProfilePhoto('user-1', created.id);

      const updated = await getProfileById('user-1', created.id);
      expect(updated!.photoUrl).toBeUndefined();
    });
  });

  describe('deleteProfile', () => {
    it('プロフィールを削除できる', async () => {
      const created = await createProfile('user-1', { name: 'たろう', age: 5 });

      await deleteProfile('user-1', created.id);

      const deleted = await getProfileById('user-1', created.id);
      expect(deleted).toBeNull();
    });
  });
});
