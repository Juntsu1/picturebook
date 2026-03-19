import { Timestamp } from 'firebase-admin/firestore';
import { getDb } from '../lib/firebase.js';
import type { TemplateRole, PageTemplate, Theme } from '@picture-book/shared';

export interface CreateTemplateInput {
  title: string;
  description: string;
  ageRange: { min: number; max: number };
  theme: Theme;
  roles: TemplateRole[];
  pages: PageTemplate[];
}

export interface TemplateResponse {
  id: string;
  title: string;
  description: string;
  ageRange: { min: number; max: number };
  theme: string;
  roles: TemplateRole[];
  pages: PageTemplate[];
  archived: boolean;
  source: 'admin' | 'chat';
  creatorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function getTemplatesCollection() {
  return getDb().collection('storyTemplates');
}

export function validateTemplate(data: CreateTemplateInput): ValidationResult {
  const errors: string[] = [];
  const definedRoles = new Set(data.roles.map((r) => r.role));

  for (const page of data.pages) {
    for (const role of page.roles) {
      if (!definedRoles.has(role)) {
        errors.push(
          `Page ${page.pageNumber} references undefined role "${role}"`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function createTemplate(
  data: CreateTemplateInput,
  creatorId?: string | null
): Promise<TemplateResponse> {
  const validation = validateTemplate(data);
  if (!validation.valid) {
    throw new Error(`Template validation failed: ${validation.errors.join(', ')}`);
  }

  const now = Timestamp.now();
  const doc = {
    title: data.title,
    description: data.description,
    ageRange: data.ageRange,
    theme: data.theme,
    roles: data.roles,
    pages: data.pages,
    archived: false,
    source: 'admin' as const,
    creatorId: creatorId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const ref = await getTemplatesCollection().add(doc);

  return {
    id: ref.id,
    ...doc,
    createdAt: now.toDate().toISOString(),
    updatedAt: now.toDate().toISOString(),
  };
}

export async function getTemplates(userId?: string): Promise<TemplateResponse[]> {
  // Query 1: public templates (creatorId == null)
  const publicQuery = getTemplatesCollection()
    .where('archived', '==', false)
    .where('creatorId', '==', null);

  const publicSnap = await publicQuery.get();

  const publicTemplates = publicSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      title: d.title as string,
      description: d.description as string,
      ageRange: d.ageRange as { min: number; max: number },
      theme: d.theme as string,
      roles: d.roles as TemplateRole[],
      pages: d.pages as PageTemplate[],
      archived: d.archived as boolean,
      source: d.source as 'admin' | 'chat',
      creatorId: d.creatorId as string | null,
      createdAt: (d.createdAt as Timestamp).toDate().toISOString(),
      updatedAt: (d.updatedAt as Timestamp).toDate().toISOString(),
    };
  });

  if (!userId) {
    return publicTemplates;
  }

  // Query 2: user's private templates
  const privateQuery = getTemplatesCollection()
    .where('archived', '==', false)
    .where('creatorId', '==', userId);

  const privateSnap = await privateQuery.get();

  const privateTemplates = privateSnap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      title: d.title as string,
      description: d.description as string,
      ageRange: d.ageRange as { min: number; max: number },
      theme: d.theme as string,
      roles: d.roles as TemplateRole[],
      pages: d.pages as PageTemplate[],
      archived: d.archived as boolean,
      source: d.source as 'admin' | 'chat',
      creatorId: d.creatorId as string | null,
      createdAt: (d.createdAt as Timestamp).toDate().toISOString(),
      updatedAt: (d.updatedAt as Timestamp).toDate().toISOString(),
    };
  });

  return [...publicTemplates, ...privateTemplates];
}

export async function getTemplateById(templateId: string): Promise<TemplateResponse | null> {
  const snap = await getTemplatesCollection().doc(templateId).get();
  if (!snap.exists) {
    return null;
  }

  const d = snap.data()!;
  return {
    id: snap.id,
    title: d.title as string,
    description: d.description as string,
    ageRange: d.ageRange as { min: number; max: number },
    theme: d.theme as string,
    roles: d.roles as TemplateRole[],
    pages: d.pages as PageTemplate[],
    archived: d.archived as boolean,
    source: d.source as 'admin' | 'chat',
    creatorId: d.creatorId as string | null,
    createdAt: (d.createdAt as Timestamp).toDate().toISOString(),
    updatedAt: (d.updatedAt as Timestamp).toDate().toISOString(),
  };
}

export async function updateTemplate(
  templateId: string,
  data: Partial<CreateTemplateInput>
): Promise<TemplateResponse | null> {
  const docRef = getTemplatesCollection().doc(templateId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return null;
  }

  const update: Record<string, unknown> = {
    ...data,
    updatedAt: Timestamp.now(),
  };

  await docRef.update(update);

  return getTemplateById(templateId);
}

export async function archiveTemplate(templateId: string): Promise<boolean> {
  const docRef = getTemplatesCollection().doc(templateId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return false;
  }

  await docRef.update({
    archived: true,
    updatedAt: Timestamp.now(),
  });

  return true;
}
