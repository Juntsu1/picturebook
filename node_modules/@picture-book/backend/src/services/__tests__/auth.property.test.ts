/**
 * Feature: personalized-picture-book
 * Property 11: 認証ラウンドトリップ
 *
 * 有効なメールアドレスとパスワードで登録後、同じ認証情報でログインすると
 * 有効なトークンが返され、異なるパスワードでは拒否されることを検証する。
 *
 * Validates: Requirements 9.2, 9.3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { Timestamp } from 'firebase-admin/firestore';

// ── In-memory Firestore mock ────────────────────────────────────────────────

interface MockDoc {
  id: string;
  data: Record<string, unknown>;
}

function createMockFirestore() {
  const collections: Record<string, MockDoc[]> = {};

  function getCollection(name: string): MockDoc[] {
    if (!collections[name]) collections[name] = [];
    return collections[name];
  }

  const firestore = {
    collection(name: string) {
      return {
        where(field: string, _op: string, value: unknown) {
          return {
            limit(_n: number) {
              return {
                async get() {
                  const docs = getCollection(name).filter(
                    (d) => d.data[field] === value,
                  );
                  return {
                    empty: docs.length === 0,
                    docs: docs.map((d) => ({
                      id: d.id,
                      data: () => ({ ...d.data }),
                      ref: {
                        async update(updates: Record<string, unknown>) {
                          Object.assign(d.data, updates);
                        },
                      },
                    })),
                  };
                },
              };
            },
          };
        },
        async add(data: Record<string, unknown>) {
          const id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          getCollection(name).push({ id, data: { ...data } });
          return { id };
        },
      };
    },
  };

  return { firestore, reset: () => Object.keys(collections).forEach((k) => delete collections[k]) };
}


// ── Mock setup ──────────────────────────────────────────────────────────────

const mockFs = createMockFirestore();

vi.mock('../../lib/firebase.js', () => ({
  getDb: () => mockFs.firestore,
  initFirebase: () => {},
}));

// Use minimal salt rounds for fast property testing (default is 10)
vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  const mod = actual as unknown as { default: typeof import('bcrypt') };
  const bcryptImpl = mod.default ?? actual;
  return {
    ...actual,
    default: {
      ...bcryptImpl,
      hash: (data: string, _rounds: number) => bcryptImpl.hash(data, 1),
      compare: bcryptImpl.compare,
    },
  };
});

// Must import after mock setup
const { registerUser, loginUser, verifyToken, AuthError } = await import(
  '../auth-service.js'
);

// ── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid email address */
const arbEmail = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
    fc.constantFrom('com', 'net', 'org', 'io'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Generate a valid password (8+ chars) */
const arbPassword = fc.stringMatching(/^[A-Za-z0-9!@#$%]{8,20}$/);

/** Generate a different password guaranteed to differ from the original */
function arbDifferentPassword(original: string) {
  return arbPassword.filter((p) => p !== original);
}

// ── Property tests ──────────────────────────────────────────────────────────

describe('Property 11: 認証ラウンドトリップ', { timeout: 60_000 }, () => {
  beforeEach(() => {
    mockFs.reset();
  });

  it('有効な認証情報で登録後、同じ認証情報でログインすると有効なトークンが返される', async () => {
    await fc.assert(
      fc.asyncProperty(arbEmail, arbPassword, async (email, password) => {
        mockFs.reset();

        // Register
        const regResult = await registerUser(email, password);
        expect(regResult.userId).toBeTruthy();
        expect(regResult.token).toBeTruthy();

        // Login with same credentials
        const loginResult = await loginUser(email, password);
        expect(loginResult.token).toBeTruthy();
        expect(loginResult.user.email).toBe(email);

        // Verify the token is valid and contains correct payload
        const payload = verifyToken(loginResult.token);
        expect(payload.email).toBe(email);
        expect(payload.userId).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });

  it('有効な認証情報で登録後、異なるパスワードでのログインは拒否される', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbEmail,
        arbPassword,
        arbPassword,
        async (email, password, wrongPassword) => {
          fc.pre(password !== wrongPassword);
          mockFs.reset();

          // Register
          await registerUser(email, password);

          // Login with wrong password should throw
          try {
            await loginUser(email, wrongPassword);
            expect.fail('異なるパスワードでのログインは拒否されるべき');
          } catch (err) {
            expect(err).toBeInstanceOf(AuthError);
            expect((err as InstanceType<typeof AuthError>).code).toBe(
              'INVALID_CREDENTIALS',
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
