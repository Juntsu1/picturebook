import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Timestamp } from 'firebase-admin/firestore';
import { getDb } from '../lib/firebase.js';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '24h';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export interface UserDoc {
  email: string;
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
}

export async function registerUser(
  email: string,
  password: string
): Promise<{ userId: string; token: string }> {
  const db = getDb();
  const usersRef = db.collection('users');

  // Check if email already exists
  const existing = await usersRef.where('email', '==', email).limit(1).get();
  if (!existing.empty) {
    throw new AuthError('このメールアドレスは既に登録されています', 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = Timestamp.now();

  const userDoc: UserDoc = {
    email,
    passwordHash,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: now,
    updatedAt: now,
  };

  const docRef = await usersRef.add(userDoc);
  const token = generateToken(docRef.id, email);

  return { userId: docRef.id, token };
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ token: string; user: { id: string; email: string } }> {
  const db = getDb();
  const usersRef = db.collection('users');

  const snapshot = await usersRef.where('email', '==', email).limit(1).get();
  if (snapshot.empty) {
    throw new AuthError('メールアドレスまたはパスワードが正しくありません', 'INVALID_CREDENTIALS');
  }

  const userDocSnap = snapshot.docs[0];
  const userData = userDocSnap.data() as UserDoc;
  const userId = userDocSnap.id;

  // Check account lock
  if (userData.lockedUntil) {
    const lockTime = userData.lockedUntil.toMillis();
    if (Date.now() < lockTime) {
      const remainingMin = Math.ceil((lockTime - Date.now()) / 60000);
      throw new AuthError(
        `アカウントがロックされています。${remainingMin}分後に再試行してください`,
        'ACCOUNT_LOCKED'
      );
    }
    // Lock expired, reset
    await userDocSnap.ref.update({
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: Timestamp.now(),
    });
    userData.failedLoginAttempts = 0;
    userData.lockedUntil = null;
  }

  const passwordMatch = await bcrypt.compare(password, userData.passwordHash);
  if (!passwordMatch) {
    const newAttempts = userData.failedLoginAttempts + 1;
    const updateData: Record<string, unknown> = {
      failedLoginAttempts: newAttempts,
      updatedAt: Timestamp.now(),
    };

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      updateData.lockedUntil = Timestamp.fromMillis(Date.now() + LOCK_DURATION_MS);
    }

    await userDocSnap.ref.update(updateData);
    throw new AuthError('メールアドレスまたはパスワードが正しくありません', 'INVALID_CREDENTIALS');
  }

  // Reset failed attempts on successful login
  await userDocSnap.ref.update({
    failedLoginAttempts: 0,
    lockedUntil: null,
    updatedAt: Timestamp.now(),
  });

  const token = generateToken(userId, email);
  return { token, user: { id: userId, email } };
}

export function generateToken(userId: string, email: string): string {
  return jwt.sign({ userId, email } satisfies AuthTokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function verifyToken(token: string): AuthTokenPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
  } catch {
    throw new AuthError('無効なトークンです', 'INVALID_TOKEN');
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
